import { Cause, Effect, type Scope } from 'effect';
import type { PreparedTrees } from './contract/service/preparedTrees.js';
import type { Sandboxes } from './contract/service/sandboxes.js';
import { drive } from '../platform/contract/service/drives.js';

const RELEASE_SWEEP_MS = 2 * 60_000;
const ENGINE_SWEEP_MS = 15 * 60_000;

export const installSandboxDrivers = Effect.fnUntraced(function* (
  sandboxes: Sandboxes['Service'],
  preparedTrees: PreparedTrees['Service'],
): Effect.fn.Return<void, never, Scope.Scope> {
  const condemned = yield* sandboxes.condemnUnfinished().pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        Effect.as(Effect.logWarning('condemning unfinished sandboxes at boot failed', failure), [] as readonly string[]),
      onSuccess: Effect.succeed,
    }),
  );
  const builds = yield* preparedTrees.condemnUnfinished().pipe(
    Effect.matchEffect({
      onFailure: (failure) => Effect.as(Effect.logWarning('condemning unfinished builds at boot failed', failure), [] as readonly string[]),
      onSuccess: Effect.succeed,
    }),
  );
  if (condemned.length + builds.length > 0) {
    yield* Effect.logInfo('unfinished sandbox work condemned at boot', {
      sandboxes: condemned,
      preparedTrees: builds,
    });
  }
  yield* drive('sandbox-sweeps', sweepSandboxes(sandboxes, preparedTrees));
});

const sweepSandboxes = Effect.fnUntraced(function* (
  sandboxes: Sandboxes['Service'],
  preparedTrees: PreparedTrees['Service'],
): Effect.fn.Return<void, never, Scope.Scope> {
  const reconcileEngineDrift = Effect.fn('sandbox.reconcileEngineDrift')(
    function* () {
      const { cleaned, released } = yield* preparedTrees.reconcile();
      const { failed, removed } = yield* sandboxes.reconcile();
      if (cleaned.length + released.length + failed.length + removed.length > 0) {
        yield* Effect.logInfo('standing engine drift reconciled', {
          preparedTrees: { cleaned, released },
          sandboxes: { failed, removed },
        });
      }
    },
    Effect.catchCause((cause) => Effect.logWarning('engine drift reconciliation could not run', { reason: Cause.squash(cause) })),
  );
  yield* Effect.forkScoped(Effect.forever(reconcileEngineDrift().pipe(Effect.andThen(Effect.sleep(ENGINE_SWEEP_MS)))));

  const sweepSandboxReleases = (): Effect.Effect<void> =>
    sandboxes.cleanup().pipe(
      Effect.tap((released) =>
        released.length === 0 ? Effect.void : Effect.logInfo('standing sandbox releases finished', { sandboxes: released }),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.logWarning('the sandbox release sweep could not run', { reason: Cause.squash(cause) })),
    );
  yield* Effect.forkScoped(Effect.forever(sweepSandboxReleases().pipe(Effect.andThen(Effect.sleep(RELEASE_SWEEP_MS)))));
});
