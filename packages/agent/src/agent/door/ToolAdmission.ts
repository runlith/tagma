import { Clock, Effect } from 'effect';
import type { PermissionSubject } from '../../permissions/vocabulary';
import { AgentToolFailed, type AgentToolFailure } from '../AgentFailure';
import {
  contributorAbsent,
  type Tool,
  ToolFailed,
  type ToolConfirmation,
  type ToolPreparation,
  toolDisplay,
  toolPrepare,
  toolSubjects,
} from '../tool';
import { toolArguments } from '../ToolArguments';
import { previewed } from '../ToolOutput';
import { DoorMisuse, projected } from './failures';
import type { CallLedger } from './CallLedger';
import type { ToolConfirmations, ToolVerdicts } from './ports';
import type { ToolRules } from './ToolRules';
import type { ToolRun } from './ToolRun';
import type { AgentPermissionQuestion, AgentToolInvocation, AgentToolPreflight } from './types';

export type ToolAdmission<TCtx> = ReturnType<typeof makeToolAdmission<TCtx>>;

export const makeToolAdmission = <TCtx>({
  run,
  ledger,
  rules,
  verdicts,
  confirmations,
  catalog,
}: {
  readonly run: ToolRun<TCtx>;
  readonly ledger: CallLedger;
  readonly rules: ToolRules<TCtx>;
  readonly verdicts: ToolVerdicts;
  readonly confirmations: ToolConfirmations;
  readonly catalog: (() => ReadonlyMap<string, Tool>) | undefined;
}) => {
  const decode = (call: AgentPermissionQuestion): Effect.Effect<unknown, AgentToolFailed> =>
    toolArguments(call.tool, call.name, call.input, catalog?.()).pipe(
      Effect.mapError((cause) => new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause })),
    );

  return {
    decode,

    lostResolution: (name: string, toolCallId: string): AgentToolFailed =>
      new AgentToolFailed({
        toolName: name,
        toolCallId,
        cause: new ToolFailed({
          reason: `The approval for ${name} was given over targets this process no longer holds. Call it again so it is resolved and approved together.`,
        }),
      }),

    accepted: (call: AgentToolInvocation, prepared: AgentToolPreflight): Effect.Effect<AgentToolPreflight> =>
      prepared.toolCallId === call.options.toolCallId &&
      prepared.name === call.name &&
      prepared.tool === call.tool &&
      ledger.currentlyPreflighted(prepared.toolCallId) &&
      Bun.deepEquals(prepared.rawInput, call.input)
        ? Effect.succeed(prepared)
        : Effect.die(new DoorMisuse(`Tool ${call.name} entered with a preflight for another call.`)),

    inspect: Effect.fnUntraced(function* (call: AgentPermissionQuestion): Effect.fn.Return<AgentToolPreflight, AgentToolFailure> {
      const openedAt = yield* Clock.currentTimeMillis;
      const runState = run.runState;
      runState.noteToolInput(call.name, call.input, call.toolCallId, runState.stepNumber);
      const input = yield* decode(call);
      const display = yield* previewed(() => toolDisplay(call.tool, input));
      const before = yield* rules.evaluate({
        hook: 'beforeTool',
        tool: { name: call.name, input, toolCallId: call.toolCallId },
        invocationKey: call.toolCallId,
        ordinal: runState.count(call.name),
      });
      rules.guide(before, { hook: 'beforeTool', toolName: call.name, toolCallId: call.toolCallId });
      const handed = ledger.resolutionFor(call.toolCallId, call.name, call.input);
      const contributor = handed?.contributor ?? call.tool.contributor;
      const prepare = toolPrepare(call.tool);
      const preparation: ToolPreparation<unknown> | null =
        prepare === null
          ? null
          : (handed?.preparation ??
            (yield* Effect.mapError(prepare(input, { toolCallId: call.toolCallId, caller: run.caller }), (cause) =>
              cause instanceof AgentToolFailed ? cause : new AgentToolFailed({ toolName: call.name, toolCallId: call.toolCallId, cause }),
            )));
      const subjects: readonly PermissionSubject[] =
        preparation === null
          ? yield* projected(call.name, call.toolCallId, 'subjects', () => toolSubjects(call.tool, input, run.caller))
          : preparation.subjects;
      const raised = preparation?.raised ?? [];
      const permission = contributorAbsent(contributor) ?? verdicts.verdict(call.tool, call.name, raised);
      const reader = permission.verdict === 'ask' && permission.timeoutMs !== null ? { withinMs: permission.timeoutMs } : undefined;
      const confirmation: ToolConfirmation | undefined =
        permission.verdict === 'ask'
          ? yield* confirmations.confirm({ call, input, prepared: preparation?.prepared, subjects, reasons: permission.reasons })
          : undefined;
      return {
        name: call.name,
        tool: call.tool,
        toolCallId: call.toolCallId,
        rawInput: call.input,
        input,
        display,
        subjects,
        prepared: preparation?.prepared,
        permission,
        confirmation,
        reader: reader,
        openedAt,
        resultRetention: call.resultRetention,
        contributor: contributor,
      };
    }),
  };
};
