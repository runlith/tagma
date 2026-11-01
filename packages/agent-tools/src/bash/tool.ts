import { Duration, Effect, Layer, Schema } from 'effect';
import { Tool, ToolFailed } from '@runlith/agent/tool';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { WorkspaceRefused, foreignCause, runToolEffect, unboundTool } from '../ToolEdge';
import { DEFAULT_COMMAND_DESCRIPTION, type ToolFactoryOptions } from '../workspace';
import { jsonCodec } from '@runlith/utils/codec';
import { resolveToolOptions } from '../workspace/runtime';
import { workspaceTarget } from '../workspace/paths';
import { displayPath } from '../display';
import { REFUSALS, refused } from '../refusals';
import { ASKS_IN_REVIEW, type Condition, type Raised } from '@runlith/agent/permissions';
import { shellFileEdit, shellOnlySleeps, shellSweepShape, type ShellFileEdit } from '../shellShapes';
import { shellDescription } from '../descriptions';
import { CheckoutBaselines } from '../CheckoutBaselines';
import { CheckoutFlights } from '../CheckoutFlights';
import { observerLost } from '../ShellRun';
import { commandTitle, finishedAnswer, finishedElsewhere, movedAnswer, ownerEnded, runningAnswer, type Retained } from './answers';
import { commandClaims, commitElsewhere, sweepsShared } from './preflight';
import { admitted, recovered } from './managed';
import { local } from './local';
import { COMMAND_LIFE, COMMAND_WAIT, humanMs } from '../CommandWork';

const descriptionSchema = Schema.String.annotate({
  description: 'Clear, concise description of what this command does in 5-10 words; omitted, the command head is shown.',
});

const bashInputSchema = Schema.Struct({
  command: Schema.String.annotate({ description: 'The command to execute' }),
  waitMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: COMMAND_WAIT.ceilingMs })).annotate({
      description: `Milliseconds this call holds the command, at most ${COMMAND_WAIT.ceilingMs}; omitted, ${COMMAND_WAIT.defaultMs} or what a command rule sets. When it passes, the command moves to the background unharmed. 0 answers at once with its address.`,
    }),
  ),
  lifeMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: COMMAND_LIFE.ceilingMs })).annotate({
      description: `Milliseconds the command may run at all, here or in the background, before it is killed; at most ${COMMAND_LIFE.ceilingMs}; omitted, ${COMMAND_LIFE.defaultMs}. A command rule may lower it.`,
    }),
  ),
  workdir: Schema.optional(
    Schema.String.annotate({
      description: 'The directory to run in; the workspace by default.',
    }),
  ),
  description: Schema.optional(descriptionSchema),
});

const requiredInputSchema = Schema.toJsonSchemaDocument(
  jsonCodec(Schema.Struct({ ...bashInputSchema.fields, description: descriptionSchema })),
  { onExcessProperty: 'error' },
).schema;

const SHARED_CHECKOUT_SWEEP: Condition = {
  id: 'shared-checkout-sweep',
  label: 'Sweeps a shared checkout',
  asksFrom: 'review',
  timeout: Duration.minutes(10),
};

const COMMIT_ELSEWHERE: Condition = { id: 'commit-elsewhere', label: 'Commits into', asksFrom: 'review', timeout: Duration.minutes(10) };

export type Params = typeof bashInputSchema.Type;

const ELSEWHERE = "This git commit lands in a checkout other than this session's own:";

const ONLY_SLEEPS =
  'A command that only sleeps holds this turn and runs nothing, so it was not run. A command you started, and an agent you started, report when they are done, and the report wakes you: end your turn, and it opens the next one. To wait for a condition, run `until <check>; do sleep 2; done` with `waitMs: 0`.';

const fileEditRefusal = (edit: ShellFileEdit) =>
  `${edit.program} rewrites ${edit.files.join(', ')} in place, so it was not run: a command's writes skip the checks the file tools make, and those its line does not name are nobody's lines. Change each named file with edit (replaceAll for every occurrence) or write; a command writes files only for a sweep across tens of files, a generator or a formatter.`;

const owned = (error: unknown) =>
  error instanceof ToolFailed
    ? error
    : error instanceof WorkspaceRefused
      ? refused('outside-workspace', error.message)
      : foreignCause(error);

export function createBashTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { cwd } = resolved;
  const { commandWork, environment, exec, files, git } = resolved.world;
  const services = files === undefined || exec === undefined || git === undefined ? undefined : Layer.mergeAll(files, exec, git);
  const baselines = new CheckoutBaselines(options.flights ?? new CheckoutFlights());
  const retained = new Map<string, Retained>();
  const bashTool = Tool.make<typeof bashInputSchema>({
    approval: { ...ASKS_IN_REVIEW, when: [SHARED_CHECKOUT_SWEEP, COMMIT_ELSEWHERE] },
    description: shellDescription({
      platform: environment.platform,
      shell: environment.shell,
      workspace: resolved.cwd,
      fenced: !resolved.allowOutsideCwd,
      tmp: environment.tmp,
      maxLines: TOOL_OUTPUT_MAX_LINES,
      maxBytes: TOOL_OUTPUT_MAX_BYTES,
      retainedBytes: commandWork === undefined ? null : commandWork.retainedBytes,
    }),
    refusals: REFUSALS,
    parameters: bashInputSchema,
    inputSchema: (options.commandDescription ?? DEFAULT_COMMAND_DESCRIPTION) === 'required' ? requiredInputSchema : undefined,
    ownWait: true,
    display: (params) => {
      const { command, description } = params;
      if (command === undefined) {
        const title = description?.trim() || undefined;
        return { form: 'none', title, alone: title === undefined ? undefined : true };
      }
      return {
        form: 'command',
        ...commandTitle({ command, description }),
        command,
        details: [
          ...(params.waitMs === undefined ? [] : [{ label: 'wait', value: `${humanMs(params.waitMs)} asked` }]),
          ...(params.lifeMs === undefined ? [] : [{ label: 'life', value: `${humanMs(params.lifeMs)} asked` }]),
        ],
      };
    },
    execute: (params, call) =>
      services === undefined
        ? unboundTool('bash', 'filesystem, git reader and process spawner')
        : runToolEffect(
            'bash',
            services,
            commandWork === undefined
              ? local(resolved.at(call.caller), services, params, call, baselines)
              : admitted(resolved.at(call.caller), commandWork, services, params, call, baselines, retained),
            call,
          ),
    settleEffect: Effect.fnUntraced(function* ({ toolCallId, toolInput, caller }) {
      const held = retained.get(toolCallId);
      if (held === undefined) {
        return commandWork === undefined || services === undefined
          ? ({ status: 'unknown' } as const)
          : yield* recovered(resolved.at(caller), commandWork, services, toolInput, baselines, toolCallId);
      }
      if (held.kind === 'unsubmitted') return { status: 'aborted' } as const;
      if (held.kind === 'uncertain') {
        return {
          status: 'completed',
          output: new Tool.ToolAnswer(
            `Whether this command started is not known: the call was interrupted while it was being admitted. Operation ${held.operation}. It was not submitted again — call read_terminal_operation with operationId ${held.operation}; an unavailable reading is not proof nothing ran.`,
            {
              form: 'command',
              ...commandTitle(held.params),
              command: held.params.command,
              facts: [{ label: 'uncertain', value: held.operation }],
            },
          ),
        } as const;
      }
      const { acceptance, params, time } = held;
      const phase = yield* Effect.result(acceptance.run.phase);
      if (phase._tag === 'Success' && phase.success !== 'ended') {
        return { status: 'completed', output: runningAnswer(params, acceptance.run, phase.success) } as const;
      }
      const observed = yield* Effect.result(acceptance.observed);
      const result = observed._tag === 'Success' ? observed.success : observerLost(observed.failure.reason);
      return {
        status: 'completed',
        output:
          time.wait.ms === 0
            ? yield* finishedElsewhere(params, null, result, acceptance.run)
            : finishedAnswer(params, yield* ownerEnded(acceptance.run, result), null, result, acceptance.run),
      } as const;
    }),
    receipt: ({ toolCallId }) => {
      const held = retained.get(toolCallId);
      return held?.kind === 'admitted'
        ? movedAnswer(held.params, held.acceptance.run, held.waited ? held.time.wait : null, held.phase())
        : undefined;
    },
    settled: ({ toolCallId }) => {
      retained.delete(toolCallId);
    },
    mutates: true,
    confirmation: {
      prompt: (input) => ({
        summary: `Run ${input.command}?`,
        facts: [{ label: 'In', value: displayPath(cwd, workspaceTarget(cwd, input.workdir)) || '.' }],
      }),
      confirmLabel: 'Run',
    },
    prepare: Effect.fnUntraced(function* (input) {
      if (commandWork !== undefined && input.waitMs !== 0 && shellOnlySleeps(input.command)) {
        return yield* refused('sleeps-only', ONLY_SLEEPS);
      }
      const edited = files === undefined ? null : shellFileEdit(input.command);
      if (edited !== null) return yield* refused('file-edit', fileEditRefusal(edited));
      const subjects = [{ kind: 'execute', value: input.command }] as const;
      if (services === undefined) return { subjects };
      const sweep = shellSweepShape(input.command);
      const swept =
        sweep !== null && (yield* sweepsShared(resolved, baselines, input, sweep).pipe(Effect.provide(services), Effect.mapError(owned)));
      const elsewhere = yield* commitElsewhere(resolved, baselines, input).pipe(Effect.provide(services), Effect.mapError(owned));
      const raised: Raised[] = [
        ...(sweep !== null && swept ? [{ condition: SHARED_CHECKOUT_SWEEP.id, fact: sweep.reason }] : []),
        ...(elsewhere === null ? [] : [{ condition: COMMIT_ELSEWHERE.id, fact: `${ELSEWHERE} ${elsewhere}` }]),
      ];
      return { subjects, raised };
    }),
    claims: (input) => commandClaims(resolved, input),
    keepsTail: true,
  });
  return bashTool;
}
