import { Cause, Context, Effect, Exit } from 'effect';
import { LLMError } from '@runlith/llm/schema/errors';
import { type Usage, sumUsage } from '@runlith/llm/schema/events';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import type { ProjectionBasis } from '../../agent/AgentContext';
import type { ModelCacheLifetime } from '@runlith/llm/models/cacheLifetime';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure } from '../ThreadBorder';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { TransportCapabilities } from '../record';
import {
  ThreadTokenCalibration,
  measuredWeight,
  type ThreadCalibrationBaseline,
  type ThreadCalibrationProfileStore,
  type ThreadCalibrationSaveFailed,
} from '../compaction/calibration';
import { corpusBaseline } from '../compaction/corpus';
import { modelOf, sameDeployment, signed, triggerOf } from '../compaction/deployment';
import { omitEarlierMedia, projectThreadOverflowRecovery } from '../compaction/overflow';
import type { ThreadMeasuredRequest, ThreadTokenEstimate } from '../compaction/measurement';
import { type ResolvedCompactionTrigger, type ThreadCompactionPolicy, threadUsableTokens } from '../compaction/policy';
import { MeteredParts, ThreadRequestMeter } from '../compaction/ThreadRequestMeter';
import { selectThreadCompactionPrefix } from '../compaction/prefix';
import { projectThreadHistory, threadCheckpointHead } from '../compaction/projection';
import { makeThreadPruner } from '../compaction/pruner';
import { COMPACTION_OFF, CompactionStrategies } from '../compaction/strategies';
import { omittedRecord, threadPictureBudget } from '../compaction/prune';
import {
  type ThreadCompactionSettle,
  type ThreadCompactionSettlement,
  type ThreadPrefixDigest,
  foldSettlement,
  pruningSettlement,
  settleIn as settleInto,
} from '../compaction/settlement';
import type {
  ThreadCompactionRefused,
  ThreadCompactionSegment,
  ThreadCompactionStrategy,
  ThreadCompactionSummary,
} from '../compaction/strategy';
import {
  ThreadCompactionConflictError,
  ThreadCompactionExhaustedError,
  ThreadCompactionOffError,
  type ThreadPrunedVolume,
  type ThreadCompactionStorage,
  ThreadNoSummarizerError,
  ThreadSummaryFailedError,
} from '../storage/compaction';
import type { ThreadCompactionText } from '../compaction/text';
import type { CompactionModels, ServedModel, ThreadModelNotServed } from '../compaction/CompactionModels';
import type { ThreadCompactionSummarizer } from '../../transcript/entries';
import {
  OWN_SUMMARIZING,
  type ThreadSummarizerPort,
  type ThreadSummarizerSelection,
  type ThreadSummarizing,
  namedSummarizing,
  summarizingOf,
} from '../compaction/summarizer';
import { makeCompactionEstimator } from './CompactionEstimator';
import { makeSummarizerRouter, type ThreadCompactionEnvelope } from './SummarizerRouter';

export type ThreadCompactionInput = {
  threadId: string;
  runId: string;
  stepNumber: number;
  ownerId: string;
  account?: string;
  cacheGroup?: string;
  provider: string;
  model: string | null;
  reasoning: string | null;
  switches: ModelSwitches | null;
  system?: string;
  history: readonly Message[];
  envelope?: Effect.Effect<ThreadCompactionEnvelope, ThreadBorderFailed>;
  tools: readonly ToolDefinition[];
  providerOptions?: unknown;
  plannedOutputTokens: number;
  overflow: boolean;
  measuredRequest?: ThreadMeasuredRequest | null;
  meter: ThreadRequestMeter;
  pictureSizes?(locations: readonly string[]): Effect.Effect<ReadonlyMap<string, number>, ThreadBorderFailed>;
  requested?: ThreadCompactionRequested;
  strategy?: string;
  onCompacting?(decision: ThreadCompactionDecision): Effect.Effect<void, ThreadBorderFailed>;
};

export type ThreadCompactionRequested = {
  readonly keep?: string;
  readonly summarizing?: ThreadSummarizing;
};

export type ThreadCompactionDecision = {
  readonly cause: 'manual' | 'overflow' | 'measured' | 'projected';
  readonly projectedTokens: number;
  readonly usableTokens: number;
  readonly measuredTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly contextWindow: number;
  readonly inputLimit: number | null;
  readonly trigger: ResolvedCompactionTrigger;
};

export type ThreadCompactionResult = {
  messages: readonly Message[];
  compacted: boolean;
  decision: ThreadCompactionDecision | null;
  settlement?: ThreadCompactionSettlement;
  summarizer?: ThreadCompactionSummarizer;
  contextWindow: number;
  inputLimit: number | null;
  correctedTokens: number;
  basis: ProjectionBasis;
};

export type ThreadManualCompactionInput = {
  threadId: string;
  runId: string;
  ownerId: string;
  account?: string;
  cacheGroup?: string;
  provider: string;
  model: string | null;
  reasoning: string | null;
  switches: ModelSwitches | null;
  sourceMessages: readonly Message[];
  envelope?: Effect.Effect<ThreadCompactionEnvelope, ThreadBorderFailed>;
  keep?: string;
  summarizing?: ThreadSummarizing;
  strategy?: string;
  onSettled?: ThreadCompactionSettle;
};

export type ThreadManualCompactionResult = {
  compacted: boolean;
  usage: Usage | null;
  settlement?: ThreadCompactionSettlement;
  summarizer?: ThreadCompactionSummarizer;
};

export type ThreadCompaction<TWrite = unknown> = ReturnType<typeof makeThreadCompaction<TWrite>>;

export const makeThreadCompaction = <TWrite = unknown>(options: {
  models: CompactionModels;
  checkpoints: ThreadCompactionStorage<TWrite>;
  policy: (thread: { readonly threadId: string }) => Effect.Effect<ThreadCompactionPolicy, ThreadPortFailure>;
  strategy: ThreadCompactionStrategy;
  recovery: ThreadCompactionStrategy;
  text: ThreadCompactionText;
  transcriptLocation?: (threadId: string) => Effect.Effect<string, ThreadBorderFailed>;
  summarizers?: ThreadSummarizerPort;
  stallMs?: number;
  calibration?: {
    store?: ThreadCalibrationProfileStore;
    baseline?: ThreadCalibrationBaseline;
  };
}) => {
  const { models, checkpoints, strategy, recovery, text, stallMs } = options;
  const calibration = new ThreadTokenCalibration({
    store: options.calibration?.store ? options.calibration.store : undefined,
    baseline: options.calibration?.baseline ?? corpusBaseline(),
  });
  const strategies = new CompactionStrategies([
    { id: 'summary', owner: '@runlith/agent', strategy },
    { id: 'digest', owner: '@runlith/agent', strategy: recovery },
  ]);
  const pruner = makeThreadPruner({ checkpoints, text });
  const router = makeSummarizerRouter({ models, strategy, stallMs });
  const metered = new MeteredParts();
  const policyOf = (thread: { readonly threadId: string }): Effect.Effect<ThreadCompactionPolicy, ThreadPortFailure> =>
    options.policy(thread).pipe(
      Effect.tap((policy) => {
        const share = policy.toolPruneProtectShare;
        return Number.isFinite(share) && share > 0 && share < 1
          ? Effect.void
          : Effect.die(new RangeError('ThreadCompactionPolicy.toolPruneProtectShare must be greater than 0 and less than 1.'));
      }),
    );
  const estimator = makeCompactionEstimator({ models, checkpoints, strategy, pruner, router, policyOf });

  const chosen = (id: string | undefined, overflow: boolean) =>
    Effect.mapError(strategies.choose(id, overflow ? recovery : strategy), (cause) => new ThreadCallBroke({ cause }));

  const basisOf = (input: ThreadCompactionInput): ThreadMeasuredRequest | null => {
    const basis = input.measuredRequest ?? null;
    return basis !== null && basis.provider === input.provider && basis.model === input.model ? basis : null;
  };

  const estimateOf = (input: ThreadCompactionInput, policy: ThreadCompactionPolicy, messages: readonly Message[]) =>
    input.meter.estimateHashed(
      {
        system: input.system,
        messages,
        tools: input.tools,
        providerOptions: input.providerOptions,
      },
      basisOf(input),
      policy.imageTokens,
    );

  const sizeOf = (
    input: ThreadCompactionInput,
    estimate: ThreadTokenEstimate & { readonly basis: ProjectionBasis },
    ratio: number | null,
  ) => {
    const own = ratio ?? measuredWeight(estimate);
    const weight = own ?? calibration.weight(input.provider, input.model);
    return { estimate, ratio: own, corrected: estimate.measured + Math.round(estimate.estimated * weight), basis: estimate.basis };
  };

  const measure = (input: ThreadCompactionInput, policy: ThreadCompactionPolicy, messages: readonly Message[], ratio: number | null) =>
    Effect.map(estimateOf(input, policy, messages), (estimate) => sizeOf(input, estimate, ratio));

  const project = Effect.fnUntraced(function* (
    input: ThreadCompactionInput,
    policy: ThreadCompactionPolicy,
    stored: readonly Message[],
    messages: readonly Message[],
  ) {
    const estimate = yield* estimateOf(input, policy, messages);
    const own = measuredWeight(estimate);
    if (own !== null || messages === stored || basisOf(input) === null) return sizeOf(input, estimate, own);
    return sizeOf(input, estimate, measuredWeight(yield* estimateOf(input, policy, stored)));
  });

  const rawSize = (input: ThreadCompactionInput, policy: ThreadCompactionPolicy, messages: readonly Message[]): number =>
    input.meter.size(
      {
        system: input.system,
        messages,
        tools: input.tools,
        providerOptions: input.providerOptions,
      },
      policy.imageTokens,
    );

  return {
    strategies,

    meter: () => new ThreadRequestMeter(metered),

    fits: Effect.fnUntraced(function* (input: ThreadCompactionInput): Effect.fn.Return<boolean, ThreadPortFailure | ThreadBorderFailed> {
      const served = yield* models.served(input.provider, input.model, input.runId);
      const capacity = served.capacity;
      const policy = yield* policyOf({ threadId: input.threadId });
      const index = pruner.index(input.history);
      const pictures = threadPictureBudget(served.requestLimits, input.pictureSizes, index);
      const pruning = yield* pruner.prune(input.threadId, index, capacity, policy, yield* pictures);
      const projection = yield* project(input, policy, input.history, pruning.messages);
      return (
        projection.corrected <=
        (capacity.input ?? capacity.context - Math.min(input.plannedOutputTokens, capacity.output ?? input.plannedOutputTokens))
      );
    }),

    persistCalibration: (): Effect.Effect<void, ThreadCalibrationSaveFailed> => calibration.persist(),

    charsPerToken: (provider: string, model: string | null): number => calibration.charsPerToken(provider, model),

    policy: policyOf,

    choosesSummarizer: options.summarizers !== undefined,

    summarizing: (ask: {
      readonly threadId: string;
      readonly runId?: string;
      readonly provider: string;
      readonly model: string | null;
      readonly running: boolean;
      readonly compaction?: TransportCapabilities['compaction'];
      readonly named?: ThreadSummarizerSelection | undefined;
    }): Effect.Effect<ThreadSummarizing, ThreadPortFailure> => {
      if (ask.named !== undefined) {
        if (ask.compaction === 'foreign' && ask.named.provider === ask.provider)
          return Effect.fail(new ThreadNoSummarizerError(ask.threadId, [{ ...ask.named, reason: 'not-callable' }]));
        return Effect.succeed(
          namedSummarizing({ provider: ask.provider, model: modelOf(models, ask.provider, ask.model, ask.runId) }, ask.named),
        );
      }
      const port = options.summarizers;
      if (port === undefined)
        return ask.compaction === 'foreign' ? Effect.fail(new ThreadNoSummarizerError(ask.threadId, [])) : Effect.succeed(OWN_SUMMARIZING);
      return Effect.flatMap(
        port({ threadId: ask.threadId, runId: ask.runId, running: ask.running, foreign: ask.compaction === 'foreign' }),
        (answered) => {
          const resolved = summarizingOf(
            ask.threadId,
            answered,
            ask.compaction === 'session'
              ? { provider: ask.provider, model: modelOf(models, ask.provider, ask.model, ask.runId) }
              : undefined,
          );
          if (resolved instanceof ThreadNoSummarizerError) return Effect.fail(resolved);
          return ask.compaction === 'foreign' && resolved.kind === 'own'
            ? Effect.fail(new ThreadNoSummarizerError(ask.threadId, []))
            : Effect.succeed(resolved);
        },
      );
    },

    intended: (
      thread: {
        readonly provider: string;
        readonly model: string | null;
        readonly reasoning: string | null;
        readonly account?: string;
        readonly runId?: string;
      },
      summarizing: ThreadSummarizing,
    ): ThreadCompactionSummarizer => {
      const first = summarizing.kind === 'foreign' ? summarizing.members[0] : undefined;
      const skipped = summarizing.kind === 'foreign' ? [...summarizing.skipped] : [];
      if (first === undefined || sameDeployment(models, thread, first)) {
        return {
          provider: thread.provider,
          model: thread.model,
          reasoning: thread.reasoning,
          ...signed(thread.account),
          own: true,
          reason: summarizing.reason,
          skipped,
        };
      }
      return {
        provider: first.provider,
        model: first.model,
        reasoning: first.reasoning,
        ...signed(first.account),
        own: false,
        reason: summarizing.reason,
        skipped,
      };
    },

    clearedVolume: (threadId: string): Effect.Effect<ThreadPrunedVolume, ThreadPortFailure> => checkpoints.prunedToolCallVolume(threadId),

    compactionCount: (threadId: string): Effect.Effect<number, ThreadPortFailure> => checkpoints.compactionCount(threadId),

    served: (provider: string, model: string | null, runId?: string): Effect.Effect<ServedModel, ThreadModelNotServed> =>
      models.served(provider, model, runId),

    clearedToolOutputText: (): string => text.prunedToolOutput,

    observeReportedUsage: (input: {
      provider: string;
      model: string | null;
      rawEstimatedTokens: number;
      reportedInputTokens: number;
    }): void => {
      calibration.observe(input.provider, input.model, input.rawEstimatedTokens, input.reportedInputTokens);
    },

    prepare: Effect.fnUntraced(function* (
      input: ThreadCompactionInput,
    ): Effect.fn.Return<ThreadCompactionResult, ThreadCompactionRefused | ThreadBorderFailed> {
      const served = yield* models.served(input.provider, input.model, input.runId);
      const capacity = served.capacity;
      const policy = yield* policyOf({ threadId: input.threadId });
      const trigger = triggerOf(served, input.provider, input.model, policy);
      const usable = threadUsableTokens(capacity, input.plannedOutputTokens, policy, trigger);
      const history = input.history;
      const index = pruner.index(history);
      const pictures = threadPictureBudget(served.requestLimits, input.pictureSizes, index);
      const pruning = yield* pruner.prune(input.threadId, index, capacity, policy, yield* pictures);
      const current = pruning.messages;
      const digest: ThreadPrefixDigest = (messages, count) => input.meter.prefixDigest(messages, count, policy.imageTokens);
      const pruned = pruningSettlement(input.threadId, pruning, history, digest);
      const projection = yield* project(input, policy, history, current);
      const measured = projection.estimate.measured > 0 ? (input.measuredRequest ?? null) : null;
      const requested = input.requested;
      const decision: ThreadCompactionDecision = {
        cause: input.overflow
          ? 'overflow'
          : requested !== undefined
            ? 'manual'
            : measured !== null && measured.inputTokens >= usable
              ? 'measured'
              : 'projected',
        projectedTokens: projection.corrected,
        usableTokens: usable,
        measuredTokens: measured?.inputTokens ?? null,
        cachedInputTokens: measured?.cachedInputTokens ?? null,
        contextWindow: capacity.context,
        inputLimit: capacity.input ?? null,
        trigger,
      };
      const unreduced = (
        messages: readonly Message[],
        decided: ThreadCompactionDecision | null,
        correctedTokens: number,
      ): ThreadCompactionResult => ({
        messages,
        compacted: false,
        decision: decided,
        settlement: pruned,
        contextWindow: capacity.context,
        inputLimit: capacity.input ?? null,
        basis: projection.basis,
        correctedTokens,
      });
      const folding = input.overflow ? omittedRecord(pruning, text) : pruning;
      const picked = yield* chosen(input.overflow && input.strategy !== COMPACTION_OFF ? undefined : input.strategy, input.overflow);
      if (picked === COMPACTION_OFF) {
        if (requested !== undefined) return yield* Effect.fail(new ThreadCompactionOffError(input.threadId));
        if (input.overflow) return yield* Effect.fail(new ThreadCompactionExhaustedError(input.threadId));
        return unreduced(current, null, projection.corrected);
      }
      if (requested === undefined) {
        if (input.overflow || projection.corrected > usable) {
          const omitted = input.overflow ? projectThreadOverflowRecovery(current, text) : omitEarlierMedia(current, text);
          if (omitted.omittedMedia > 0) {
            const sized = yield* measure(input, policy, omitted.messages, projection.ratio);
            if (sized.corrected <= usable) {
              const settlement = pruningSettlement(input.threadId, folding, history, digest);
              return { ...unreduced(omitted.messages, decision, sized.corrected), settlement: settlement ?? pruned };
            }
          }
        } else if (measured === null || measured.inputTokens < usable || (measured.cachedInputTokens ?? 0) > 0) {
          return unreduced(current, null, projection.corrected);
        }
      }

      const form = router.form(input, requested ? 'manual' : 'automatic', requested?.summarizing, policy, picked);
      const firstCut =
        requested === undefined
          ? null
          : form.select
            ? form.select(current, 0)
            : selectThreadCompactionPrefix(current, 0, threadUsableTokens(capacity, policy.bufferTokens, policy, trigger), policy);
      if (requested !== undefined && (firstCut === null || firstCut <= 0)) return unreduced(current, decision, projection.corrected);
      if (input.onCompacting) yield* input.onCompacting(decision);
      const sent = (messages: readonly Message[]) => (input.overflow ? projectThreadOverflowRecovery(messages, text).messages : messages);
      let projected = current;
      let raw = rawSize(input, policy, projected);
      let covered = 0;
      let head = 0;
      let last: ThreadCompactionSummary | undefined;
      let usage: Usage | null = null;
      let summarizer: ThreadCompactionSummarizer | undefined;
      let sized = projection;
      for (let cuts = 0; last === undefined || sized.corrected > usable; cuts += 1) {
        const cut =
          cuts === 0 && firstCut !== null
            ? firstCut
            : form.select
              ? form.select(projected, 0)
              : (selectThreadCompactionPrefix(projected, 0, usable, policy) ?? projected.length);
        if (cut === null || cut <= head) return yield* Effect.fail(new ThreadCompactionExhaustedError(input.threadId));
        const formed = yield* compacting(
          form,
          router.segment(input, served, policy, {
            messages: projected,
            alreadyCovered: 0,
            coveredMessageCount: cut,
            priorSummary: null,
            keep: requested?.keep,
          }),
          decision.cause,
          (formed) => formed.summary.coveredMessageCount,
        );
        const folded = formed.summary;
        if (folded.coveredMessageCount <= head) return yield* Effect.fail(new ThreadCompactionExhaustedError(input.threadId));
        summarizer ??= formed.summarizer;
        usage = folded.usage === null ? usage : sumUsage(usage, folded.usage);
        const next = projectThreadHistory(projected, folded, text.checkpointMarker, policy);
        const nextRaw = rawSize(input, policy, next);
        if (nextRaw >= raw) return yield* Effect.fail(new ThreadCompactionExhaustedError(input.threadId));
        covered += folded.coveredMessageCount - head;
        head = next.length - (projected.length - folded.coveredMessageCount);
        projected = next;
        raw = nextRaw;
        last = folded;
        sized = yield* measure(input, policy, sent(projected), projection.ratio);
      }
      const settlement = foldSettlement({
        threadId: input.threadId,
        sourceRunId: input.runId,
        history,
        covered,
        head: projected.slice(0, head),
        summary: last.summary,
        usage,
        pruning: folding,
        digest,
      });
      if (settlement === undefined) return yield* Effect.fail(new ThreadCompactionConflictError(input.threadId));
      return {
        messages: sent(projected),
        compacted: true,
        decision,
        settlement,
        summarizer: summarizer,
        contextWindow: capacity.context,
        inputLimit: capacity.input ?? null,
        basis: projection.basis,
        correctedTokens: sized.corrected,
      };
    }),

    compact: Effect.fnUntraced(function* (
      input: ThreadManualCompactionInput,
    ): Effect.fn.Return<ThreadManualCompactionResult, ThreadCompactionRefused | ThreadBorderFailed> {
      if (input.sourceMessages.length === 0) return { compacted: false, usage: null };
      const served = yield* models.served(input.provider, input.model, input.runId);
      const capacity = served.capacity;
      const policy = yield* policyOf({ threadId: input.threadId });
      const trigger = triggerOf(served, input.provider, input.model, policy);
      const checkpoint = yield* checkpoints.latestCheckpoint(input.threadId);
      const alreadyCovered = 0;
      const meter = new ThreadRequestMeter(metered);

      const pruning = yield* pruner.prune(input.threadId, pruner.index(input.sourceMessages), capacity, policy);
      const boundedMessages = pruning.messages;
      const picked = yield* chosen(input.strategy, false);
      if (picked === COMPACTION_OFF) return yield* Effect.fail(new ThreadCompactionOffError(input.threadId));
      const form = router.form(input, 'manual', input.summarizing ?? OWN_SUMMARIZING, policy, picked);
      const coveredMessageCount = form.select
        ? form.select(boundedMessages, alreadyCovered)
        : (selectThreadCompactionPrefix(
            boundedMessages,
            alreadyCovered,
            threadUsableTokens(capacity, policy.bufferTokens, policy, trigger),
            policy,
          ) ?? boundedMessages.length);
      if (coveredMessageCount === null) return { compacted: false, usage: null };
      const formed = yield* compacting(
        form,
        router.segment(input, served, policy, {
          messages: input.sourceMessages,
          alreadyCovered,
          coveredMessageCount,
          priorSummary: checkpoint?.summary ?? null,
          keep: input.keep,
        }),
        'manual',
        (formed) => formed.summary.coveredMessageCount,
      );
      const summarized = formed.summary;
      const settlement = foldSettlement({
        threadId: input.threadId,
        sourceRunId: input.runId,
        history: input.sourceMessages,
        covered: summarized.coveredMessageCount,
        head: threadCheckpointHead(summarized, text.checkpointMarker, input.sourceMessages, policy),
        summary: summarized.summary,
        usage: summarized.usage,
        pruning,
        digest: (messages, count) => meter.prefixDigest(messages, count, policy.imageTokens),
      });
      return {
        compacted: true,
        usage: summarized.usage,
        summarizer: formed.summarizer,
        settlement: settlement,
      };
    }),

    transcriptLocation: (threadId: string): Effect.Effect<string, ThreadBorderFailed> =>
      options.transcriptLocation === undefined
        ? Effect.fail(new ThreadCallBroke({ cause: new Error('The selected compaction policy requires a transcript location.') }))
        : options.transcriptLocation(threadId),

    settleIn(settlement: ThreadCompactionSettlement, tx: TWrite): Effect.Effect<void, ThreadPortFailure> {
      return settleInto(checkpoints, settlement, tx);
    },

    estimate: estimator.estimate,
  };
};

export class ThreadCompactor extends Context.Service<ThreadCompactor, ThreadCompaction<ThreadWriteTx>>()(
  '@runlith/agent/ThreadCompactor',
) {}

export type CompactionAttrs = {
  readonly cause: ThreadCompactionDecision['cause'];
  readonly from: number;
  readonly covered: number;
};

export const COMPACTION = activityKind<CompactionAttrs, { readonly covered?: number }>('compaction');

function compacting<A, E>(
  form: { summarize(segment: ThreadCompactionSegment): Effect.Effect<A, E> },
  segment: ThreadCompactionSegment,
  cause: ThreadCompactionDecision['cause'],
  covered: (formed: A) => number,
): Effect.Effect<A, E> {
  return activity(COMPACTION, { cause, from: segment.alreadyCovered, covered: segment.coveredMessageCount }, form.summarize(segment), {
    thread: segment.threadId,
    ended: (exit) => (Exit.isSuccess(exit) ? { result: { covered: covered(exit.value) } } : { reason: providerReasonOf(exit.cause) }),
  });
}

function providerReasonOf(cause: Cause.Cause<unknown>): string | undefined {
  const refused = cause.reasons.find(Cause.isFailReason)?.error;
  return refused instanceof ThreadSummaryFailedError && refused.failure instanceof LLMError ? refused.failure.reason._tag : undefined;
}
