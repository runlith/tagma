import { Clock, Effect } from 'effect';
import type { PermissionSubject } from '../../permissions/vocabulary';
import { AgentToolFailed, type AgentRuleFailed, type AgentToolFailure } from '../AgentFailure';
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
import { agentCallDirective } from '../policy/AgentRuntimePolicy';
import { DoorMisuse, projected } from './failures';
import type { CallLedger } from './CallLedger';
import type { ToolConfirmations, ToolVerdicts } from './ports';
import type { ToolRules } from './ToolRules';
import type { ToolRun } from './ToolRun';
import type { AgentPermissionQuestion, AgentToolInvocation, AgentToolPreflight } from './types';

const RULE_DENIED = 'permission-denied';

type Judged = { readonly input: unknown; readonly denied: string | null; readonly rewritten: boolean };

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

  const rewritten = (call: AgentPermissionQuestion, given: unknown, ruleId: string | undefined): Effect.Effect<unknown, AgentToolFailed> =>
    toolArguments(call.tool, call.name, given, catalog?.()).pipe(
      Effect.mapError(
        (invalid) =>
          new AgentToolFailed({
            toolName: call.name,
            toolCallId: call.toolCallId,
            cause: new ToolFailed({
              reason: `Rule ${ruleId ?? 'unnamed'} replaced the input of this call with one ${call.name} does not take: ${invalid.message}`,
            }),
          }),
      ),
    );

  const judged = new Map<string, Judged>();

  const judge = Effect.fnUntraced(function* (call: AgentPermissionQuestion): Effect.fn.Return<Judged, AgentToolFailed | AgentRuleFailed> {
    const held = judged.get(call.toolCallId);
    if (held !== undefined) return held;
    const handed = ledger.resolutionFor(call.toolCallId, call.name, call.input);
    if (handed !== undefined) return { input: handed.judged, denied: null, rewritten: handed.rewritten === true };
    const runState = run.runState;
    runState.noteToolInput(call.name, call.input, call.toolCallId, runState.stepNumber);
    const decoded = yield* decode(call);
    const before = yield* rules.evaluate({
      hook: 'beforeTool',
      tool: { name: call.name, input: decoded, toolCallId: call.toolCallId },
      invocationKey: call.toolCallId,
      ordinal: runState.count(call.name),
    });
    rules.guide(before, { hook: 'beforeTool', toolName: call.name, toolCallId: call.toolCallId });
    const directed = agentCallDirective(before);
    const verdict: Judged = {
      input: directed?.type === 'rewrite' ? yield* rewritten(call, directed.input, directed.ruleId) : decoded,
      denied: directed?.type === 'deny' ? directed.reason : null,
      rewritten: directed?.type === 'rewrite',
    };
    judged.set(call.toolCallId, verdict);
    return verdict;
  });

  return {
    decode,

    judge,

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
      const { input, denied, rewritten: changed } = yield* judge(call);
      judged.delete(call.toolCallId);
      const display = yield* previewed(() => toolDisplay(call.tool, input));
      if (denied !== null) {
        return {
          name: call.name,
          tool: call.tool,
          toolCallId: call.toolCallId,
          rawInput: call.input,
          input,
          display,
          subjects: [],
          prepared: undefined,
          permission: { verdict: 'deny', code: RULE_DENIED, reason: denied },
          confirmation: undefined,
          reader: undefined,
          openedAt,
          resultRetention: call.resultRetention,
          contributor: call.tool.contributor,
        };
      }
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
        rewritten: changed ? true : undefined,
      };
    }),
  };
};
