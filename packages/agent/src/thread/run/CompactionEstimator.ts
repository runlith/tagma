import { Effect } from 'effect';
import type { CompactionModels } from '../compaction/CompactionModels';
import { sameDeployment, triggerOf } from '../compaction/deployment';
import { estimateThreadTokens } from '../compaction/measurement';
import { type ThreadCompactionPolicy, threadUsableTokens } from '../compaction/policy';
import { selectThreadCompactionPrefix } from '../compaction/prefix';
import type { ThreadPruner } from '../compaction/pruner';
import type { ThreadCompactionEstimate, ThreadCompactionEstimateInput } from '../compaction/summarizer';
import type { ThreadCompactionSegment, ThreadCompactionStrategy } from '../compaction/strategy';
import type { ThreadCompactionStorage } from '../storage/compaction';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { SummarizerRouter, ThreadCompactionIdentity } from './SummarizerRouter';

export const makeCompactionEstimator = <TWrite>(options: {
  readonly models: CompactionModels;
  readonly checkpoints: ThreadCompactionStorage<TWrite>;
  readonly strategy: ThreadCompactionStrategy;
  readonly pruner: ThreadPruner;
  readonly router: SummarizerRouter;
  readonly policyOf: (thread: { readonly threadId: string }) => Effect.Effect<ThreadCompactionPolicy, ThreadPortFailure>;
}) => {
  const { models, checkpoints, strategy, pruner, router, policyOf } = options;
  const planned = (segment: ThreadCompactionSegment): ThreadCompactionEstimate => {
    const plan = strategy.passes?.(segment);
    if (plan === undefined) {
      return { inputTokens: estimateThreadTokens(segment.messages.slice(segment.alreadyCovered, segment.coveredMessageCount)), passes: 1 };
    }
    return { inputTokens: plan.inputTokens, passes: plan.boundaries === null ? null : plan.boundaries.length };
  };

  return {
    estimate: Effect.fnUntraced(function* (input: ThreadCompactionEstimateInput) {
      const nothing: ThreadCompactionEstimate = { inputTokens: 0, passes: 0 };
      if (input.history.length === 0) return { own: nothing, candidates: input.candidates.map(() => nothing) };
      const policy = yield* policyOf({ threadId: input.threadId });
      const served = yield* models.served(input.provider, input.model);
      const capacity = served.capacity;
      const trigger = triggerOf(served, input.provider, input.model, policy);
      const checkpoint = yield* checkpoints.latestCheckpoint(input.threadId);
      const bounded = yield* pruner.bounded(input.threadId, input.history, capacity, policy);
      const identity: ThreadCompactionIdentity = {
        threadId: input.threadId,
        ownerId: input.ownerId,
        account: input.account ?? undefined,
        provider: input.provider,
        model: input.model,
        reasoning: input.reasoning,
        switches: input.switches,
      };
      const profile = router.profile(identity, 'manual');
      const covered = profile
        ? profile.select(bounded, 0)
        : (selectThreadCompactionPrefix(bounded, 0, threadUsableTokens(capacity, policy.bufferTokens, policy, trigger), policy) ??
          bounded.length);
      if (covered === null) return { own: nothing, candidates: input.candidates.map(() => nothing) };
      const segment = router.segment(identity, served, policy, {
        messages: input.history,
        alreadyCovered: 0,
        coveredMessageCount: covered,
        priorSummary: checkpoint?.summary ?? null,
        keep: input.keep,
      });
      const own: ThreadCompactionEstimate = profile
        ? { inputTokens: estimateThreadTokens(input.history.slice(0, covered), policy.imageTokens) + input.fixedTokens, passes: 1 }
        : planned(segment);
      const candidates = yield* Effect.forEach(input.candidates, (member) =>
        sameDeployment(models, identity, member)
          ? Effect.succeed(own)
          : Effect.map(router.under(segment, member, policy), (under) => planned(under)),
      );
      return { own, candidates };
    }),
  };
};
