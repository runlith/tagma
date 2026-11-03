import { Cause, Effect, Exit } from 'effect';
import { isContextOverflowFailure } from '@runlith/llm/provider-error';
import type { CompactionSummary } from '@runlith/llm/schema/compaction';
import { LLMResponse, type Usage, sumUsage } from '@runlith/llm/schema/events';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { discoveredToolNames } from '../../agent/AgentDeferredTools';
import type { ThreadCompactionSummarizer } from '../../transcript/entries';
import { pairedForProvider } from './toolPairing';
import { ThreadCallBroke, type ThreadBorderFailed, threadCauseOf } from '../ThreadBorder';
import { ThreadCompactionExhaustedError, ThreadNoSummarizerError, ThreadSummaryFailedError } from '../storage/compaction';
import type { CompactionModels, ServedModel, ThreadModelNotServed } from '../compaction/CompactionModels';
import { sameDeployment, signed, triggerOf } from '../compaction/deployment';
import { estimateThreadTokens } from '../compaction/measurement';
import { type ThreadCompactionPolicy, threadUsableTokens } from '../compaction/policy';
import { previousThreadCompactionBoundary } from '../compaction/prefix';
import type { ResolvedSummarizer, ThreadSummarizing } from '../compaction/summarizer';
import { ThreadSummarizerWindowError, fallThrough } from '../compaction/summarizerFailure';
import type {
  ThreadCompactionRefused,
  ThreadCompactionSegment,
  ThreadCompactionStrategy,
  ThreadCompactionSummary,
} from '../compaction/strategy';

export type ThreadCompactionEnvelope = {
  readonly instructions: string;
  readonly tools: readonly ToolDefinition[];
  readonly transcriptLocation: string;
  lower(messages: readonly Message[]): Effect.Effect<readonly Message[], ThreadBorderFailed>;
};

export type ThreadCompactionFormed = {
  readonly summary: ThreadCompactionSummary;
  readonly summarizer: ThreadCompactionSummarizer | undefined;
};

export type ThreadCompactionForm = {
  readonly select?: (messages: readonly Message[], alreadyCovered: number) => number | null;
  summarize(segment: ThreadCompactionSegment): Effect.Effect<ThreadCompactionFormed, ThreadCompactionRefused | ThreadBorderFailed>;
};

export type ThreadCompactionIdentity = {
  readonly threadId: string;
  readonly runId?: string;
  readonly ownerId: string;
  readonly account?: string;
  readonly cacheGroup?: string;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches | null;
  readonly envelope?: Effect.Effect<ThreadCompactionEnvelope, ThreadBorderFailed>;
};

export type ThreadCompactionProfile = {
  readonly select: (messages: readonly Message[], alreadyCovered: number) => number | null;
  summarize(segment: ThreadCompactionSegment): Effect.Effect<ThreadCompactionSummary, ThreadBorderFailed>;
};

export function lineageOf(
  segment: ThreadCompactionSegment,
  coveredMessageCount: number,
  source: ThreadCompactionEnvelope,
  mode: 'manual' | 'automatic',
): CompactionSummary {
  const preserved = segment.messages.slice(coveredMessageCount).findLast((message) => message.role === 'assistant');
  const referenced = discoveredToolNames(segment.messages);
  const toolReferences = source.tools.filter((tool) => tool.deferred && referenced.has(tool.name)).map((tool) => tool.name);
  return {
    mode,
    transcriptLocation: source.transcriptLocation,
    keep: segment.keep,
    id: crypto.randomUUID(),
    toolReferences: toolReferences.length === 0 ? undefined : toolReferences,
    preservedCount: segment.messages.length - coveredMessageCount,
    previousMessageId: preserved?.id,
    previousRequestId: preserved?.requestId,
  };
}

export type SummarizerRouter = ReturnType<typeof makeSummarizerRouter>;

export const makeSummarizerRouter = ({
  models,
  strategy,
  stallMs,
}: {
  readonly models: CompactionModels;
  readonly strategy: ThreadCompactionStrategy;
  readonly stallMs: number | undefined;
}) => {
  const folded = Effect.fnUntraced(function* (
    segment: ThreadCompactionSegment,
  ): Effect.fn.Return<
    { readonly summary: ThreadCompactionSummary; readonly passes: number; readonly usage: Usage | null },
    ThreadCompactionRefused | ThreadCallBroke
  > {
    const plan = strategy.passes?.(segment);
    if (plan !== undefined && plan.boundaries === null) {
      return yield* new ThreadCallBroke({ cause: new ThreadSummarizerWindowError(segment.provider, segment.model ?? '') });
    }
    let covered = segment.alreadyCovered;
    let prior = segment.priorSummary;
    let usage: Usage | null = null;
    let passes = 0;
    let last: ThreadCompactionSummary | undefined;
    for (const target of plan?.boundaries ?? [segment.coveredMessageCount]) {
      while (covered < target) {
        const summary = yield* strategy.summarize({
          ...segment,
          alreadyCovered: covered,
          coveredMessageCount: target,
          priorSummary: prior,
        });
        if (summary.coveredMessageCount <= covered) return yield* Effect.fail(new ThreadCompactionExhaustedError(segment.threadId));
        passes += 1;
        usage = summary.usage === null ? usage : sumUsage(usage, summary.usage);
        covered = summary.coveredMessageCount;
        prior = summary.summary;
        last = summary;
      }
    }
    if (last === undefined) return yield* Effect.fail(new ThreadCompactionExhaustedError(segment.threadId));
    return { summary: last, passes, usage };
  });

  const continuation = (
    identity: ThreadCompactionIdentity,
    segment: ThreadCompactionSegment,
    coveredMessageCount: number,
    mode: 'manual' | 'automatic',
  ): Effect.Effect<CompactionSummary, ThreadBorderFailed> => {
    const envelope = identity.envelope;
    if (envelope === undefined) {
      return Effect.fail(new ThreadCallBroke({ cause: new Error('The selected compaction policy requires a thread context source.') }));
    }
    return Effect.map(envelope, (source) => lineageOf(segment, coveredMessageCount, source, mode));
  };

  const foreign = (
    identity: ThreadCompactionIdentity,
    mode: 'manual' | 'automatic',
    summarizing: Extract<ThreadSummarizing, { kind: 'foreign' }>,
    policy: ThreadCompactionPolicy,
    profile: ThreadCompactionProfile | undefined,
    own: (summary: ThreadCompactionSummary, skipped: ThreadCompactionSummarizer['skipped']) => ThreadCompactionFormed,
  ): ThreadCompactionForm['summarize'] =>
    Effect.fnUntraced(function* (segment) {
      const skipped: ThreadCompactionSummarizer['skipped'][number][] = [...summarizing.skipped];
      for (const member of summarizing.members) {
        const ownDeployment = sameDeployment(models, identity, member);
        const attempt = yield* Effect.exit(
          ownDeployment
            ? Effect.map((profile ?? strategy).summarize(segment), (summary) => ({ summary, passes: 1, usage: summary.usage }))
            : Effect.flatMap(router.under(segment, member, policy), (under) => folded(under)),
        );
        if (Exit.isSuccess(attempt)) {
          const { summary, passes, usage } = attempt.value;
          if (ownDeployment) return own(summary, [...skipped]);
          const context = profile === undefined ? undefined : yield* continuation(identity, segment, summary.coveredMessageCount, mode);
          return {
            summary: { ...summary, usage, context: context },
            summarizer: {
              provider: member.provider,
              model: member.model,
              reasoning: member.reasoning,
              ...signed(summary.account ?? member.account),
              own: false,
              reason: summarizing.reason,
              skipped: [...skipped],
              passes,
              usage: usage ?? undefined,
            },
          } satisfies ThreadCompactionFormed;
        }
        if (Cause.hasInterrupts(attempt.cause)) return yield* Effect.failCause(attempt.cause);
        const reason = summarizing.reason === 'named' ? null : fallThrough(threadCauseOf(Cause.squash(attempt.cause)));
        if (reason === null) return yield* Effect.failCause(attempt.cause);
        skipped.push({ provider: member.provider, model: member.model, reason });
      }
      return yield* Effect.fail(new ThreadNoSummarizerError(identity.threadId, skipped));
    });

  const router = {
    segment(
      identity: ThreadCompactionIdentity,
      served: ServedModel,
      policy: ThreadCompactionPolicy,
      cut: {
        messages: readonly Message[];
        alreadyCovered: number;
        coveredMessageCount: number;
        priorSummary: string | null;
        keep?: string;
      },
    ): ThreadCompactionSegment {
      const trigger = triggerOf(served, identity.provider, identity.model, policy);
      const capacity = served.capacity;
      return {
        threadId: identity.threadId,
        runId: identity.runId,
        ownerId: identity.ownerId,
        account: identity.account,
        cacheGroup: identity.cacheGroup,
        provider: identity.provider,
        model: identity.model,
        reasoning: identity.reasoning,
        switches: identity.switches ?? {},
        messages: cut.messages,
        alreadyCovered: cut.alreadyCovered,
        coveredMessageCount: cut.coveredMessageCount,
        priorSummary: cut.priorSummary,
        usableTokens: (plannedOutputTokens) => threadUsableTokens(capacity, plannedOutputTokens, policy, trigger),
        summaryBudgetTokens: policy.bufferTokens,
        stallMs,
        keep: cut.keep,
      };
    },

    form(
      identity: ThreadCompactionIdentity,
      mode: 'manual' | 'automatic',
      summarizing: ThreadSummarizing | undefined,
      policy: ThreadCompactionPolicy,
      fallback: ThreadCompactionStrategy,
    ): ThreadCompactionForm {
      const profile = router.profile(identity, mode);
      const own = (
        summary: ThreadCompactionSummary,
        reason: ThreadSummarizing['reason'] | undefined,
        skipped: ThreadCompactionSummarizer['skipped'] = [],
      ): ThreadCompactionFormed => ({
        summary,
        summarizer:
          reason === undefined
            ? undefined
            : {
                provider: identity.provider,
                model: identity.model,
                reasoning: identity.reasoning,
                ...signed(summary.account ?? identity.account),
                own: true,
                reason,
                skipped,
                passes: 1,
                usage: summary.usage ?? undefined,
              },
      });
      const summarize: ThreadCompactionForm['summarize'] =
        summarizing?.kind === 'foreign'
          ? foreign(identity, mode, summarizing, policy, profile, (summary, skipped) => own(summary, summarizing.reason, skipped))
          : (segment) => Effect.map((profile ?? fallback).summarize(segment), (summary) => own(summary, summarizing?.reason));
      return profile === undefined ? { summarize } : { select: profile.select, summarize };
    },

    under(
      segment: ThreadCompactionSegment,
      member: ResolvedSummarizer,
      policy: ThreadCompactionPolicy,
    ): Effect.Effect<ThreadCompactionSegment, ThreadModelNotServed> {
      return Effect.map(models.served(member.provider, member.model, segment.runId), (served) => {
        const trigger = triggerOf(served, member.provider, member.model, policy);
        const { account: _account, cacheGroup: _cacheGroup, ...rest } = segment;
        return {
          ...rest,
          account: member.account,
          provider: member.provider,
          model: member.model,
          reasoning: member.reasoning,
          switches: {},
          usableTokens: (plannedOutputTokens) => threadUsableTokens(served.capacity, plannedOutputTokens, policy, trigger),
        };
      });
    },

    profile(identity: ThreadCompactionIdentity, mode: 'manual' | 'automatic'): ThreadCompactionProfile | undefined {
      const request = models.request({
        ownerId: identity.ownerId,
        runId: identity.runId,
        account: identity.account,
        cacheGroup: identity.cacheGroup,
        lane: identity.threadId,
        provider: identity.provider,
        model: identity.model,
        reasoning: identity.reasoning,
        switches: identity.switches ?? {},
        stallMs,
      });
      const selected = request.compaction;
      if (selected === undefined) return undefined;
      const envelope = identity.envelope;
      return {
        select: selected.select,
        summarize: Effect.fnUntraced(function* (segment: ThreadCompactionSegment) {
          if (envelope === undefined) {
            return yield* new ThreadCallBroke({ cause: new Error('The selected compaction policy requires a thread context source.') });
          }
          const source = yield* envelope;
          const context = {
            mode,
            transcriptLocation: source.transcriptLocation,
            keep: segment.keep,
          };
          let coveredMessageCount = segment.coveredMessageCount;
          for (;;) {
            const messages = segment.messages.slice(segment.alreadyCovered, coveredMessageCount);
            const attempt = yield* Effect.exit(
              selected.summarize({
                messages: yield* source.lower(pairedForProvider(messages)),
                instructions: source.instructions,
                tools: source.tools,
                context,
              }),
            );
            if (Exit.isFailure(attempt)) {
              const failure = Cause.squash(attempt.cause);
              const previous = previousThreadCompactionBoundary(segment.messages, segment.alreadyCovered, coveredMessageCount);
              if (isContextOverflowFailure(failure) && previous !== null) {
                coveredMessageCount = previous;
                continue;
              }
              return yield* Effect.failCause(attempt.cause).pipe(
                Effect.mapError((refused) => new ThreadSummaryFailedError(segment, 'model', refused.message, refused)),
              );
            }
            const { summary, response } = attempt.value;
            if (estimateThreadTokens(summary) > request.plannedOutputTokens) {
              return yield* new ThreadCallBroke({ cause: new Error('The compaction summary exceeded its output budget.') });
            }
            return {
              coveredMessageCount,
              summary,
              usage: LLMResponse.usage(response) ?? null,
              context: lineageOf(segment, coveredMessageCount, source, mode),
              ...signed(request.signedAccount?.()),
            } satisfies ThreadCompactionSummary;
          }
        }),
      };
    },
  };
  return router;
};
