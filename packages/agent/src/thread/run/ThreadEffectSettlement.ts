import { Effect, Result } from 'effect';
import { toJson } from '@runlith/utils/json';
import { toolArguments } from '../../agent/ToolArguments';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import type { ToolCaller } from '../../agent/contracts';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import {
  type ToolEffectSettlement,
  type ToolOutcome,
  ToolAnswer,
  documentAsked,
  toolExecute,
  toolSettleEffect,
  verdictOutcome,
} from '../../agent/tool';
import { type AgentToolModelOutput, agentToolModelOutput, doorToolModelOutput } from '../../agent/ToolOutput';
import { THREAD_TOOL_INPUT_INTERRUPTED, settleTool, toolSettled } from '../../transcript/entries';
import type { ThreadToolEntry } from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadTranscript } from '../../transcript/rows';
import type { ThreadPendingInteraction } from '../rows';
import type { ThreadRunRef } from './ThreadRunLedger';
import { actDigest, type TransitionOutcome } from '../keyed';
import type { ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { transitionNow, type TransitionDeps } from '../transition/kernel';
import type { Decision } from '../transition/port';
import { type ThreadBorderFailed, ThreadCallBroke } from '../ThreadBorder';
import type { ThreadEventBody } from '../events';
import { ToolSettlements } from '../../agent/ToolSettlements';
import { recordedToolEntry } from '../ToolSettlements';

export const EFFECT_ABORTED_BY_DEATH = 'The process died before this tool call settled; the attempt is aborted.';
export const EFFECT_UNKNOWN_AFTER_DEATH =
  'The process died before this tool call settled; whether the effect happened is unknown — verify before repeating it.';
export const EFFECT_TORN_BEFORE_RECORD = 'The process died while this call was still streaming; the model never recorded it.';
export const EFFECT_STOPPED_BEFORE_SETTLING =
  'The run ended before this tool call settled; whether the effect happened is unknown — verify before repeating it.';
export const EFFECT_NEVER_STARTED = 'The run ended before this call started; it did not run.';
export const READ_UNANSWERED =
  'The run ended before this call answered; it changes nothing, so nothing happened — call it again for its answer.';

export type ThreadEffectSettlementResult = {
  readonly settled: number;
  readonly interactive: readonly ThreadToolEntry[];
};

export const settleInterruptedEffects = Effect.fnUntraced(function* (deps: {
  kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  run: ThreadRunRef;
  entries: ThreadTranscript;
  catalog: ToolCatalog;
  caller: ToolCaller;
}): Effect.fn.Return<ThreadEffectSettlementResult, ThreadBorderFailed> {
  const entries = deps.entries;
  const settlements = yield* ToolSettlements;
  const history = yield* deps.kernel.store.historyOf(deps.run.threadId);
  if (history === null) return { settled: 0, interactive: [] };
  const answers = new Map<string, ThreadEventBody | 'interactive'>();
  for (const effect of unsettledEffects(entries, deps.run.id)) {
    if (!historyCarriesCall(history, effect.toolCallId)) {
      answers.set(effect.toolCallId, terminalEvent(effect, { kind: 'cancelled', output: EFFECT_TORN_BEFORE_RECORD }, null));
      continue;
    }
    const declared = deps.catalog[effect.toolName];
    let input: unknown = effect.toolInput;
    if (declared !== undefined) {
      const parsed = yield* Effect.result(
        toolArguments(declared, effect.toolName, effect.toolInput, () => new Map(Object.entries(deps.catalog))),
      );
      if (Result.isFailure(parsed)) {
        const output = parsed.failure.output;
        answers.set(
          effect.toolCallId,
          terminalEvent(
            effect,
            { kind: 'refused', refusal: parsed.failure.refusal, output },
            toolResultMessage(
              effect,
              documentAsked(declared, effect.toolInput) ? doorToolModelOutput(output) : { type: 'text', value: parsed.failure.text },
            ),
          ),
        );
        continue;
      }
      input = parsed.success;
    }
    if (!declared || !toolExecute(declared)) {
      answers.set(effect.toolCallId, 'interactive');
      continue;
    }
    answers.set(effect.toolCallId, yield* settlementEvent(deps.catalog, effect, input, deps.caller));
  }

  const outcome = yield* transitionNow<ThreadEffectSettlementResult, ThreadWriteTx, ThreadBorderFailed, ThreadTx>(
    deps.kernel,
    deps.run.threadId,
    {
      declared: [],
      decide: Effect.fnUntraced(function* (_view, tx) {
        const events: ThreadEventBody[] = [];
        const interactive: ThreadToolEntry[] = [];
        const stillOpen = yield* deps.kernel.store.entriesOfRun(deps.run.threadId, deps.run.id, tx);
        if (settlements !== undefined) {
          const confirmed = stillOpen.filter(
            (entry) => coreEntry(entry) && entry.type === 'tool' && answers.has(entry.toolCallId) && toolSettled(entry.toolState),
          );
          if (confirmed.length > 0) {
            yield* tx.afterCommit(
              Effect.sync(() => {
                for (const entry of confirmed) recordedToolEntry(settlements, entry);
              }),
            );
          }
        }
        for (const effect of unsettledEffects(stillOpen, deps.run.id)) {
          const answer = answers.get(effect.toolCallId);
          if (answer === undefined) continue;
          if (answer === 'interactive') interactive.push(effect);
          else events.push(answer);
        }
        const result: ThreadEffectSettlementResult = { settled: events.length, interactive };
        const decision: Decision<ThreadEffectSettlementResult, ThreadWriteTx> =
          events.length === 0 ? { replayed: result } : { apply: true, result, events };
        return decision;
      }),
    },
    { evidence: { settlement: deps.run.id, effects: [...answers.keys()] }, digest: actDigest([deps.run.id, [...answers.keys()]]) },
  );
  return settledOf(outcome);
});

function settledOf(outcome: TransitionOutcome<ThreadEffectSettlementResult>): ThreadEffectSettlementResult {
  if ('committed' in outcome) return outcome.committed;
  if ('replayed' in outcome) return outcome.replayed;
  if ('refused' in outcome) return outcome.refused;
  return { settled: 0, interactive: [] };
}

export function unsettledEffects(transcript: ThreadTranscript, runId: string): readonly ThreadToolEntry[] {
  return transcript.flatMap((entry) =>
    coreEntry(entry) && entry.type === 'tool' && entry.runId === runId && callIsOpen(entry) ? [entry] : [],
  );
}

function callIsOpen(call: ThreadToolEntry): boolean {
  return !toolSettled(call.toolState);
}

const settlementEvent = Effect.fnUntraced(function* (
  catalog: ToolCatalog,
  effect: ThreadToolEntry,
  toolInput: unknown,
  caller: ToolCaller,
): Effect.fn.Return<ThreadEventBody, ThreadCallBroke> {
  const entry = catalog[effect.toolName];
  const settlements = yield* ToolSettlements;
  const settled = entry?.settled;
  const identity = { toolCallId: effect.toolCallId, caller };
  const claim =
    settled === undefined
      ? undefined
      : settlements?.retain(
          identity,
          () => settled(identity),
          () => false,
        );
  const settling =
    entry === undefined
      ? null
      : toolSettleEffect(entry, { toolCallId: effect.toolCallId, toolInput, caller, json: documentAsked(entry, effect.toolInput) });
  const settlement: ToolEffectSettlement | null =
    settling === null
      ? null
      : yield* settling.pipe(Effect.catchTag('Tool.Failed', () => Effect.succeed<ToolEffectSettlement>({ status: 'unknown' })));
  claim?.ended();
  if (entry !== undefined && settlement?.status === 'completed') {
    const recovered = settlement.output;
    const output = recovered instanceof ToolAnswer ? recovered.value : recovered;
    const text = recovered instanceof ToolAnswer ? recovered.text : undefined;
    const modelOutput: AgentToolModelOutput =
      text === undefined
        ? yield* Effect.try({
            try: () => agentToolModelOutput({ tool: entry, toolCallId: effect.toolCallId, caller, toolInput, output }),
            catch: (cause) => new ThreadCallBroke({ cause }),
          })
        : { type: 'text', value: text };
    const verdict = recovered instanceof ToolAnswer ? recovered.verdict : ({ kind: 'answered' } as const);
    return terminalEvent(effect, verdictOutcome(verdict, toJson(output)), toolResultMessage(effect, modelOutput));
  }
  const outcome: ToolOutcome =
    settlement?.status === 'aborted'
      ? { kind: 'cancelled', output: EFFECT_ABORTED_BY_DEATH }
      : startedReading(effect)
        ? { kind: 'cancelled', output: READ_UNANSWERED }
        : { kind: 'unknown', output: EFFECT_UNKNOWN_AFTER_DEATH };
  return terminalEvent(effect, outcome, toolResultMessage(effect, { type: 'error-text', value: outcome.output }));
});

export function unsettledCallEvents(
  runId: string,
  transcript: ThreadTranscript,
  history: readonly Message[],
  asked: ThreadPendingInteraction = null,
  reason: string = EFFECT_STOPPED_BEFORE_SETTLING,
): readonly ThreadEventBody[] {
  const announced = new Set(history.flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-call' ? [part.id] : []))));
  const calls = new Map<string, ThreadToolEntry>();
  for (const entry of transcript) {
    if (!coreEntry(entry) || entry.type !== 'tool' || entry.runId !== runId) continue;
    calls.set(entry.toolCallId, entry);
  }
  const awaited = askedToolCallIds(asked);
  return [...calls.values()].flatMap((call) => {
    if (!callIsOpen(call) || awaited.has(call.toolCallId)) return [];
    if (call.toolState === 'input-streaming') return [interruptedEvent(call)];
    const unstarted = call.execution?.state === 'queued' && call.execution.gated === true;
    const reads = startedReading(call);
    const said = unstarted ? EFFECT_NEVER_STARTED : reads ? READ_UNANSWERED : reason;
    return [
      terminalEvent(
        call,
        { kind: unstarted || reads ? 'cancelled' : 'unknown', output: said },
        announced.has(call.toolCallId) ? toolResultMessage(call, { type: 'error-text', value: said }) : null,
      ),
    ];
  });
}

export function startedReading(call: ThreadToolEntry): boolean {
  return call.execution?.state === 'started' && call.execution.mutates === false;
}

function askedToolCallIds(asked: ThreadPendingInteraction): ReadonlySet<string> {
  if (!asked) return new Set();
  return new Set(asked.toolCalls.map((call) => call.toolCallId));
}

function interruptedEvent(effect: ThreadToolEntry): ThreadEventBody {
  const terminal: ThreadToolEntry = {
    ...effect,
    toolState: THREAD_TOOL_INPUT_INTERRUPTED,
    occurredAt: new Date().toISOString(),
  };
  return { kind: 'tool', payload: { entry: terminal } };
}

function terminalEvent(effect: ThreadToolEntry, outcome: ToolOutcome, message: Message | null): ThreadEventBody {
  const terminal: ThreadToolEntry = { ...effect, ...settleTool(outcome), occurredAt: new Date().toISOString() };
  return { kind: 'tool', payload: { entry: terminal, messages: message ? [message] : undefined } };
}

function toolResultMessage(effect: ThreadToolEntry, output: unknown): Message {
  return Message.tool(ToolResultPart.from({ id: effect.toolCallId, name: effect.toolName, result: output }));
}

function historyCarriesCall(history: readonly Message[], toolCallId: string): boolean {
  return history.some(
    (message) => message.role === 'assistant' && message.content.some((part) => part.type === 'tool-call' && part.id === toolCallId),
  );
}
