import { Cause, Effect } from 'effect';

const SHUTDOWN_DEADLINE_MS = 60_000;

export const closingDeadline = (close: () => void) => (signal: string) => {
  close();
  setTimeout(() => {
    console.error(
      `[tagma] pid ${process.pid} did not close within ${SHUTDOWN_DEADLINE_MS / 1000}s of ${signal}; it leaves without finishing, and SQLite keeps only what committed`,
    );
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
};

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
