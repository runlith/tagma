import { Deferred, Effect, Exit } from 'effect';
import type { BindingId } from '@runlith/executions/protocol/custody';
import { permits, type Permits } from '@runlith/held/Permits';

export type InputAdmission<F> = {
  readonly enter: <A, E>(lane: BindingId, act: Effect.Effect<A, E>) => Effect.Effect<A, E | F>;
  readonly close: Effect.Effect<void>;
};

type Turn = { readonly permits: Permits; waiting: number };

export const makeInputAdmission = <F>({ closed }: { readonly closed: () => F }): InputAdmission<F> => {
  const turns = new Map<BindingId, Turn>();
  let open = true;
  let acting = 0;
  let quiet: Deferred.Deferred<void> | undefined;

  const left = Effect.sync(() => {
    acting -= 1;
    if (acting === 0 && quiet !== undefined) Deferred.doneUnsafe(quiet, Exit.void);
  });

  const acted = <A, E>(act: Effect.Effect<A, E>): Effect.Effect<A, E | F> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend((): Effect.Effect<A, E | F> => {
        if (!open) return Effect.fail(closed());
        acting += 1;
        return Effect.ensuring(restore(act), left);
      }),
    );

  const enter = <A, E>(lane: BindingId, act: Effect.Effect<A, E>): Effect.Effect<A, E | F> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend((): Effect.Effect<A, E | F> => {
        if (!open) return Effect.fail(closed());
        const turn = turns.get(lane) ?? { permits: permits(1), waiting: 0 };
        turns.set(lane, turn);
        turn.waiting += 1;
        return Effect.ensuring(
          restore(turn.permits.within(acted(act))),
          Effect.sync(() => {
            turn.waiting -= 1;
            if (turn.waiting === 0) turns.delete(lane);
          }),
        );
      }),
    );

  return {
    enter,
    close: Effect.suspend(() => {
      open = false;
      if (acting === 0) return Effect.void;
      quiet ??= Deferred.makeUnsafe<void>();
      return Deferred.await(quiet);
    }),
  };
};
