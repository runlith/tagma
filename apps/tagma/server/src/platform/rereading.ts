import { Cause, Deferred, Effect, Exit, type Scope } from 'effect';

export type Rereading = {
  dirty: boolean;
  reading: boolean;
  readonly first: Deferred.Deferred<void>;
};

export const openRereading = Effect.map(Deferred.make<void>(), (first): Rereading => ({ first, dirty: true, reading: true }));

export const rereading = Effect.fnUntraced(
  function* (
    state: Rereading,
    live: () => boolean,
    settle: Effect.Effect<void>,
    broke: (cause: Cause.Cause<never>) => Effect.Effect<void>,
  ) {
    for (;;) {
      if (!state.dirty || !live()) {
        state.reading = false;
        return;
      }
      state.dirty = false;
      const settled = yield* Effect.exit(settle);
      if (Exit.isFailure(settled)) {
        if (Cause.hasInterruptsOnly(settled.cause)) return;
        console.error('[tagma] a rereading cycle broke', Cause.pretty(settled.cause));
        yield* broke(settled.cause);
      }
      yield* Deferred.succeed(state.first, undefined);
    }
  },
  (effect, state, live, settle, broke) =>
    effect.pipe(
      Effect.ensuring(
        Effect.andThen(
          Effect.sync(() => {
            state.reading = false;
          }),
          Deferred.succeed(state.first, undefined),
        ),
      ),
    ),
);

export const wake = (state: Rereading, cycle: Effect.Effect<void>, scope: Scope.Scope): Effect.Effect<void> | undefined => {
  state.dirty = true;
  if (state.reading) return undefined;
  state.reading = true;
  return Effect.asVoid(Effect.forkIn(cycle, scope));
};
