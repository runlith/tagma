import { Cause, Effect } from 'effect';

export function stopServer(closeStack: Effect.Effect<void>): Effect.Effect<boolean> {
  return closeStack.pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        console.error('[tagma] shutting down the run owners did not finish', Cause.squash(cause));
        return false;
      }),
    ),
  );
}
