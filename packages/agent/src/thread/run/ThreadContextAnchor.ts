import { resolveCachePolicy } from '@runlith/llm/cache-policy';
import type { ThreadModelSelection } from '../agents/ThreadAgent';
import { Cause, Clock, Effect, Exit } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import type { Usage } from '@runlith/llm/schema/events';
import type { AgentCallMeasurement } from '../../agent/AgentCallMeasurement';
import type { AgentActualRequest, AgentContext, AgentContextInput, AgentContextProjection } from '../../agent/AgentContext';
import { AgentHostFailed } from '../../agent/AgentFailure';
import type { ThreadCompactionEntry, ThreadCompactionReceipt, ThreadCompactionSummarizer } from '../../transcript/entries';
import { compactionEntryId, requestedCompactionEntryId } from '../../transcript/entryNames';
import { ThreadCompactor, type ThreadCompactionDecision, type ThreadCompactionInput } from './ThreadCompaction';
import { ThreadCompactionRuns, type ThreadCompactionTaken } from './ThreadCompactionRuns';
import type { ThreadCompactionRefused } from '../compaction/strategy';
import type { ThreadSummarizerSelection } from '../compaction/summarizer';
import { COMPACTION_OFF } from '../compaction/strategies';
import {
  ThreadCompactionConflictError,
  ThreadCompactionExhaustedError,
  ThreadCompactionOffError,
  ThreadNoSummarizerError,
  ThreadSummaryFailedError,
} from '../storage/compaction';
import type { ThreadMeasuredRequest } from '../compaction/measurement';
import type { ThreadContextReading } from '../rows';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadAttachments, type ThreadToolOutputScopeFaces } from '../ThreadPorts';
import { alreadyPaired, pairedForProvider } from './toolPairing';
const LOWERED_LINEAGES = 2;
export type ThreadCompactionAsked = {
  readonly ids: readonly string[];
  readonly keep?: string;
  readonly summarizer?: ThreadSummarizerSelection;
};
export type ThreadCompactionRequests = {
  take(): Effect.Effect<ThreadCompactionAsked | null, ThreadBorderFailed>;
};
export type ThreadAnchoredThread = {
  readonly id: string;
  readonly cacheGroup: string;
  readonly contextReading: ThreadContextReading | null;
};
type ThreadAnchoredStep = {
  readonly number: number;
  history: readonly Message[];
  projection: AgentContextProjection | null;
};
export interface ThreadContextAnchor extends AgentContext {
  contextWindow(): number | null;
  inputLimit(): number | null;
}
export type ThreadAnchorInput = {
  readonly thread: ThreadAnchoredThread;
  readonly runId: string;
  readonly model: ThreadModelSelection;
  readonly strategy?: string;
  readonly outputScope: ThreadToolOutputScopeFaces;
  readonly history: Effect.Effect<readonly Message[], ThreadBorderFailed>;
  readonly requests?: ThreadCompactionRequests;
  readonly onProgress?: Effect.Effect<void, ThreadBorderFailed>;
};
export const makeThreadContextAnchors = Effect.gen(function* () {
  const compactor = yield* ThreadCompactor;
  const compactionRuns = yield* ThreadCompactionRuns;
  const attachments = yield* ThreadAttachments;
  const clock = yield* Clock.Clock;
  return ({ thread, runId, model, strategy, outputScope, history, requests, onProgress }: ThreadAnchorInput): ThreadContextAnchor => {
    const meter = compactor.meter();
    const observing = compactor.meter();
    const sized = new Map<string, number | null>();
    let measured = trustedBasis(thread.contextReading);
    let window: number | null = null;
    let limit: number | null = null;
    let anchoredStep: ThreadAnchoredStep | null = null;
    const contextWindow = (): number | null => {
      return window;
    };
    const inputLimit = (): number | null => {
      return limit;
    };
    const project = Effect.fn('ThreadContextAnchor.project')(
      function* (context: AgentContextInput) {
        const held = anchoredStep?.number === context.stepNumber ? anchoredStep : null;
        if (held?.projection && !context.contextOverflow) return held.projection;
        const step: ThreadAnchoredStep = held ?? { number: context.stepNumber, history: yield* history, projection: null };
        anchoredStep = step;
        const request = context.contextOverflow || requests === undefined ? null : yield* requests.take();
        const projection = yield* pass(context, step, request);
        step.projection = projection;
        return projection;
      },
      Effect.mapError((cause) => new AgentHostFailed({ port: 'project', cause })),
    );
    const pass = Effect.fnUntraced(function* (
      context: AgentContextInput,
      step: ThreadAnchoredStep,
      request: ThreadCompactionAsked | null,
      without = false,
    ): Effect.fn.Return<AgentContextProjection, ThreadCompactionRefused | ThreadBorderFailed> {
      const compactionId =
        request === null ? compactionEntryId(runId, context.stepNumber) : requestedCompactionEntryId(runId, context.stepNumber);
      const mode: ThreadCompactionEntry['mode'] = request === null ? 'automatic' : 'manual';
      const answering: ThreadCompactionTaken | undefined = request === null ? undefined : { runId: runId, ids: request.ids };
      let taken: ThreadCompactionDecision | null = null;
      let compactingAt = '';
      let intended: ThreadCompactionSummarizer | undefined;
      const compactionInput: ThreadCompactionInput = {
        threadId: thread.id,
        runId: runId,
        stepNumber: context.stepNumber,
        ownerId: model.ownerId,
        account: model.account,
        cacheGroup: thread.cacheGroup,
        provider: context.provider ?? model.provider,
        model: context.model ?? model.model,
        reasoning: model.reasoning,
        switches: model.switches,
        system: context.system || undefined,
        history: step.history,
        tools: context.tools,
        envelope: Effect.map(
          Effect.suspend(() => compactor.transcriptLocation(thread.id)),
          (transcriptLocation) => ({
            instructions: context.system ?? '',
            tools: context.tools,
            transcriptLocation,
            lower: (messages: readonly Message[]) => attachments.hydrate(thread.id, messages),
          }),
        ),
        providerOptions: context.providerOptions || undefined,
        plannedOutputTokens: context.plannedOutputTokens,
        overflow: context.contextOverflow,
        ...(without ? { strategy: COMPACTION_OFF } : strategy === undefined ? {} : { strategy: strategy }),
        measuredRequest: measured,
        meter: meter,
        pictureSizes: (locations) => pictureSizes(locations),
        onCompacting: (decision: ThreadCompactionDecision) =>
          Effect.sync(() => {
            taken = decision;
            compactingAt = new Date(clock.currentTimeMillisUnsafe()).toISOString();
          }).pipe(
            Effect.andThen(() =>
              compactionRuns.recordEntry(thread.id, {
                type: 'compaction',
                id: compactionId,
                runId: runId,
                mode,
                status: 'running',
                occurredAt: compactingAt,
                receipt: receiptOf(decision),
                summarizer: intended,
              }),
            ),
            Effect.andThen(context.phase?.('compacting') ?? Effect.void),
            Effect.andThen(onProgress ?? Effect.void),
          ),
      };
      const closing = (
        status: ThreadCompactionEntry['status'],
        decision: ThreadCompactionDecision | null,
        recorded: Pick<ThreadCompactionEntry, 'summarizer' | 'noSummarizer'> = {},
      ): ThreadCompactionEntry => {
        const at = new Date(clock.currentTimeMillisUnsafe()).toISOString();
        return {
          type: 'compaction',
          id: compactionId,
          runId: runId,
          mode,
          status,
          occurredAt: compactingAt || at,
          updatedAt: at,
          receipt: decision === null ? undefined : receiptOf(decision),
          ...recorded,
        };
      };
      const summarizing =
        request === null
          ? Effect.succeed(undefined)
          : compactor.summarizing({
              threadId: thread.id,
              runId: runId,
              provider: compactionInput.provider,
              model: compactionInput.model,
              running: true,
              named: request.summarizer,
            });
      const road = Effect.flatMap(summarizing, (resolved) => {
        intended =
          resolved === undefined
            ? undefined
            : compactor.intended(
                {
                  provider: compactionInput.provider,
                  runId: compactionInput.runId,
                  model: compactionInput.model,
                  reasoning: compactionInput.reasoning,
                  account: compactionInput.account,
                },
                resolved,
              );
        const input: ThreadCompactionInput =
          request === null
            ? compactionInput
            : {
                ...compactionInput,
                requested: {
                  keep: request.keep,
                  summarizing: resolved,
                },
              };
        return compactor.prepare(input);
      });
      const stopped =
        answering === undefined
          ? Effect.void
          : Effect.suspend(() => compactionRuns.recordEntry(thread.id, closing('aborted', taken), undefined, answering)).pipe(
              Effect.exit,
              Effect.flatMap((recorded) =>
                Exit.isSuccess(recorded)
                  ? Effect.void
                  : Effect.logWarning('a stopped compaction could not record its ending', {
                      runId: runId,
                      cause: Cause.pretty(recorded.cause),
                    }),
              ),
            );
      const attempt = yield* Effect.exit(road.pipe(Effect.onInterrupt(() => stopped)));
      if (Exit.isFailure(attempt)) {
        if (Cause.hasInterruptsOnly(attempt.cause)) return yield* Effect.failCause(attempt.cause);
        const refused = Cause.squash(attempt.cause);
        const failed = compactionRuns.recordEntry(
          thread.id,
          closing('failed', taken, refused instanceof ThreadNoSummarizerError ? { noSummarizer: { skipped: refused.skipped } } : {}),
          undefined,
          answering,
        );
        if (answering !== undefined) {
          yield* failed;
          return yield* pass(context, step, null);
        }
        if (without || !refusedCompaction(refused) || !(yield* compactor.fits(compactionInput))) {
          return yield* Effect.failCause(attempt.cause);
        }
        if (taken !== null) yield* failed;
        return yield* pass(context, step, null, true);
      }
      const projected = attempt.value;
      window = projected.contextWindow;
      limit = projected.inputLimit;
      const settlement = projected.settlement;
      if (settlement !== undefined) {
        const settled =
          taken !== null && projected.compacted
            ? yield* compactionRuns.settle(
                thread.id,
                settlement,
                closing('completed', taken, projected.summarizer === undefined ? {} : { summarizer: projected.summarizer }),
                answering,
              )
            : yield* compactionRuns.foldPruning(thread.id, settlement);
        if (settled) {
          step.history = [...settlement.replaced.messages, ...step.history.slice(settlement.replaced.keepFrom)];
        } else if (projected.compacted) {
          yield* compactionRuns.recordEntry(thread.id, closing('failed', taken), undefined, answering);
          return yield* Effect.fail(new ThreadCompactionConflictError(thread.id));
        }
      }
      if (projected.compacted) {
        yield* (onProgress ?? Effect.void).pipe(Effect.andThen(context.phase?.('preparing') ?? Effect.void));
      } else if (answering !== undefined) {
        yield* compactionRuns
          .recordEntry(thread.id, closing('unchanged', projected.decision), undefined, answering)
          .pipe(Effect.andThen(onProgress ?? Effect.void));
      }
      return {
        messages: projected.messages,
        estimate: {
          tokens: projected.correctedTokens,
          contextWindow: projected.contextWindow,
          premiumAbove: projected.premiumAbove,
          basis: projected.basis === 'none' && thread.contextReading?.stale ? 'stale' : projected.basis,
        },
      };
    });
    const pictureSizes = (locations: readonly string[]): Effect.Effect<ReadonlyMap<string, number>, ThreadBorderFailed> => {
      const unread = [...new Set(locations)].filter((location) => !sized.has(location));
      const read = unread.length === 0 ? Effect.succeed(new Map<string, number>()) : attachments.sizes(thread.id, unread);
      return Effect.map(read, (found) => {
        for (const location of unread) sized.set(location, found.get(location) ?? null);
        return new Map(
          locations.flatMap((location) => {
            const size = sized.get(location);
            return size === null || size === undefined ? [] : [[location, size] as const];
          }),
        );
      });
    };
    const lowered = new Map<Message, { readonly source: readonly Message[]; readonly sent: readonly Message[] }>();
    const continued = (source: readonly Message[], messages: readonly Message[]): boolean => {
      if (messages.length < source.length) return false;
      for (let at = 0; at < source.length; at += 1) if (messages[at] !== source[at]) return false;
      return true;
    };
    const kept = (source: readonly Message[], sent: readonly Message[]): readonly Message[] => {
      const first = source[0];
      if (first === undefined) return sent;
      lowered.delete(first);
      lowered.set(first, { source, sent });
      for (const oldest of lowered.keys()) {
        if (lowered.size <= LOWERED_LINEAGES) break;
        lowered.delete(oldest);
      }
      return sent;
    };
    const lower = (messages: readonly Message[]): Effect.Effect<readonly Message[], AgentHostFailed> =>
      Effect.suspend(() => {
        const first = messages[0];
        const held = first === undefined ? undefined : lowered.get(first);
        const tail = held !== undefined && continued(held.source, messages) ? messages.slice(held.source.length) : null;
        if (held !== undefined && tail !== null && alreadyPaired(tail)) {
          return outputScope.projectMessages(tail).pipe(
            Effect.flatMap((bounded) => attachments.hydrate(thread.id, bounded)),
            Effect.map((sent) => kept(messages, [...held.sent, ...sent])),
          );
        }
        return outputScope.projectMessages(messages).pipe(
          Effect.flatMap((bounded) => attachments.hydrate(thread.id, pairedForProvider(bounded))),
          Effect.map((sent) => (alreadyPaired(messages) ? kept(messages, sent) : sent)),
        );
      }).pipe(
        Effect.mapError((cause) => new AgentHostFailed({ port: 'lower', cause })),
        Effect.withSpan('ThreadContextAnchor.lower'),
      );
    const observe = Effect.fn('ThreadContextAnchor.observe')(
      function* (request: AgentActualRequest, usage: Usage | undefined) {
        const inputTokens = usage?.inputTokens;
        if (usage === undefined || inputTokens === undefined || inputTokens <= 0) return undefined;
        const policy = yield* compactor.policy({ threadId: thread.id });
        const metered = yield* observing.requestHashed(
          {
            system: request.system,
            messages: request.messages,
            tools: request.tools,
            providerOptions: request.providerOptions,
          },
          policy.imageTokens,
        );
        compactor.observeReportedUsage({
          provider: request.provider ?? model.provider,
          model: request.model,
          rawEstimatedTokens: metered.tokens,
          reportedInputTokens: inputTokens,
        });
        const provider = request.provider ?? model.provider;
        const served = yield* compactor.served(provider, request.model, runId);
        const capacity = served.capacity;
        const ttlSeconds = resolveCachePolicy(request.cache).ttlSeconds ?? served.cacheLifetime.promisedSeconds;
        const measurement: AgentCallMeasurement = {
          runId: request.runId,
          stepNumber: request.stepNumber,
          attempt: request.attempt,
          activity: request.activity,
          provider: request.provider,
          model: request.model,
          account: request.account,
          reasoning: request.reasoning,
          usage,
          contextWindow: capacity.context,
          inputLimit: capacity.input ?? null,
          footprint: metered.footprint,
          measuredAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          sentAt: request.sentAt,
          cache: { ttlSeconds },
        };
        measured = {
          inputTokens,
          cachedInputTokens: usage.cacheReadInputTokens ?? null,
          provider: request.provider,
          model: request.model,
          footprint: metered.footprint,
        };
        return measurement;
      },
      Effect.mapError((cause) => new AgentHostFailed({ port: 'observe', cause })),
    );
    return { contextWindow, inputLimit, project, lower, observe };
  };
});
function receiptOf(decision: ThreadCompactionDecision): ThreadCompactionReceipt {
  return {
    cause: decision.cause,
    projectedTokens: decision.projectedTokens,
    usableTokens: decision.usableTokens,
    measuredTokens: decision.measuredTokens ?? undefined,
    cachedInputTokens: decision.cachedInputTokens ?? undefined,
    contextWindow: decision.contextWindow,
    inputLimit: decision.inputLimit,
    trigger: {
      source: decision.trigger.source,
      strategy: decision.trigger.strategy,
      share: decision.trigger.strategy === 'percent' ? decision.trigger.trigger : undefined,
    },
  };
}
function trustedBasis(reading: ThreadContextReading | null): ThreadMeasuredRequest | null {
  if (reading === null || reading.stale) return null;
  if (reading.footprint === undefined) return null;
  const inputTokens = reading.usage.inputTokens;
  if (inputTokens === undefined || inputTokens <= 0) return null;
  return {
    inputTokens,
    cachedInputTokens: reading.usage.cacheReadInputTokens ?? null,
    provider: reading.provider,
    model: reading.model,
    footprint: reading.footprint,
  };
}
function refusedCompaction(failure: unknown): boolean {
  return (
    failure instanceof ThreadCompactionConflictError ||
    failure instanceof ThreadCompactionExhaustedError ||
    failure instanceof ThreadCompactionOffError ||
    failure instanceof ThreadNoSummarizerError ||
    failure instanceof ThreadSummaryFailedError
  );
}
