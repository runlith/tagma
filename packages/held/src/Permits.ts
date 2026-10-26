import { Effect } from 'effect';
import { ResourceInvalid } from './failures.js';

export type Permits = {
  within<A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  standing(): { readonly taken: number; readonly queued: number };
};

type Waiter = { granted: boolean; wake: (() => void) | undefined };

export const permits = (count: number): Permits => {
  if (!(count >= 1)) throw new ResourceInvalid({ resource: 'permits', reason: 'a pool needs at least one permit' });
  let taken = 0;
  const queue: Waiter[] = [];

  const pump = (): void => {
    while (taken < count && queue.length > 0) {
      const next = queue.shift()!;
      taken += 1;
      next.granted = true;
      next.wake?.();
    }
  };

  const leave = (waiter: Waiter): void => {
    if (waiter.granted) taken -= 1;
    else queue.splice(queue.indexOf(waiter), 1);
    pump();
  };

  const granted = (waiter: Waiter): Effect.Effect<void> =>
    Effect.callback<void>((resume) => {
      if (waiter.granted) return resume(Effect.void);
      waiter.wake = () => resume(Effect.void);
    });

  return {
    within: (work) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          const waiter: Waiter = { granted: false, wake: undefined };
          queue.push(waiter);
          pump();
          return restore(Effect.andThen(granted(waiter), work)).pipe(Effect.ensuring(Effect.sync(() => leave(waiter))));
        }),
      ),
    standing: () => ({ taken, queued: queue.length }),
  };
};
