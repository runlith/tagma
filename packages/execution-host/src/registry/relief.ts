import { Clock, Effect, Ref } from 'effect';
import type { CapacityBudget, CapacityRefused, LiveCounts } from '../ExecutionCapacity';
import { type CountLimit } from '@runlith/executions/protocol/capacity';
import { type RegistryState, recordHandles } from './state';

export type Relief = {
  readonly reading: { readonly _tag: 'Measured'; readonly counts: LiveCounts } | { readonly _tag: 'Unreadable'; readonly detail: string };
};

export const kernelCount = (budget: CapacityBudget): boolean => budget === 'host.executions' || budget === 'host.terminals';

export const relieve = Effect.fn('Executions.relieve')(function* (registry: RegistryState): Effect.fn.Return<Relief> {
  const { capacity, platform, recounted } = registry;
  const now = yield* Clock.currentTimeMillis;
  const last = yield* Ref.get(recounted);
  if (last !== undefined && platform !== undefined && now - last < platform.recountMs) {
    return { reading: { _tag: 'Measured', counts: yield* capacity.counts() } };
  }
  if (platform === undefined) {
    return {
      reading: { _tag: 'Unreadable', detail: 'the platform provides no capacity facts to read again' },
    };
  }
  return yield* capacity
    .recount(platform, () => recordHandles(registry))
    .pipe(
      Effect.tap(() => Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.set(recounted, now))),
      Effect.match({
        onFailure: (failure): Relief => ({
          reading: {
            _tag: 'Unreadable',
            detail:
              failure._tag === 'LimitsUnreadable'
                ? `this kernel did not answer its own limits: ${failure.detail}`
                : `${failure.region} could not be read: ${failure.detail}`,
          },
        }),
        onSuccess: (counts): Relief => ({ reading: { _tag: 'Measured', counts } }),
      }),
    );
});

export const countDetail = (failure: CapacityRefused, relief: Relief): string => {
  if (relief.reading._tag === 'Unreadable') {
    return `${failure.budget} at ${failure.limit}, and this machine could not be read again: ${relief.reading.detail}`;
  }
  const wanted = failure.budget === 'host.terminals' ? 'terminals' : undefined;
  const terms = relief.reading.counts.terms.filter((term) => (wanted === undefined ? term.limit !== 'terminals' : term.limit === wanted));
  const bound = terms.reduce<CountLimit | undefined>(
    (least, term) => (least === undefined || term.count < least.count ? term : least),
    undefined,
  );
  return bound === undefined
    ? `${failure.budget} at ${failure.limit}, re-measured against this kernel`
    : `${failure.budget} at ${failure.limit}, re-measured against this kernel: ${bound.detail}`;
};
