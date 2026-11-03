import { join } from 'node:path';
import { Cause, Deferred, Effect, Exit, Result } from 'effect';
import { ACTIVITY_DATABASE } from '../activity/contract/service/place.js';
import { readAttempt } from '../installation/closure/attempt.js';
import { holdingProcess } from '../installation/closure/leases.js';
import type { InstallHeld } from '../installation/closure/moves.js';
import { databasePathIn, installationRootIn } from '../installation/paths.js';
import { arrive, enterTrial, rollBack, type Trial, type TrialPlace, wordsOf } from '../installation/process/trial.js';
import { ATTEMPT_STARTS } from '../installation/contract/wire/attempt.js';
import { PERFORMANCE_DATABASE } from '../performance/contract/service/place.js';
import { ownStoreDirectory } from '../platform/contract/service/ownStore.js';
import { storeDirectory } from '../platform/contract/service/store.js';
import { lockDataDirectory } from '../platform/lock/dataDirectory.js';
import type { Channel } from '../installation/contract/wire/channel.js';

export type AttemptPlace = {
  readonly installRoot: string;
  readonly release: string | undefined;
  readonly storePath: string;
};

const trialPlace = ({ installRoot, release, storePath }: AttemptPlace): TrialPlace => ({
  installRoot,
  release,
  files: [storePath, join(storeDirectory(storePath), ACTIVITY_DATABASE), join(storeDirectory(storePath), PERFORMANCE_DATABASE)],
  stores: ownStoreDirectory(storePath),
});

export type Arrival = {
  readonly trial: Trial | null;
  readonly opened: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
};

let entered: Trial | null = null;

const detailOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const startFailed = (cause: unknown): Effect.Effect<void> =>
  Effect.suspend(() => (entered === null || entered.settled() ? Effect.void : entered.failed(detailOf(cause), wordsOf(cause))));

export const startFailure =
  (record: (detail: string) => void) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
    Effect.andThen(
      Effect.sync(() => record(Cause.pretty(cause))),
      startFailed(Cause.squash(cause)),
    );

//! the cli and the server are separate bundles, each with its own copy of this module; the trial lives in the server's
const FAILED_BEFORE_DOOR = 'tagma:failed-before-door';

const told = (error: unknown): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (!process.emit(FAILED_BEFORE_DOOR, error, () => resume(Effect.void))) resume(Effect.void);
  });

export const beforeDoor = <A, E, R>(serving: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.onExit(serving, (exit) =>
    Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? told(Cause.squash(exit.cause)) : Effect.void,
  );

const left = (): Effect.Effect<never> => Effect.sync((): never => process.exit(1));

const unlocked = (held: InstallHeld): Effect.Effect<never> =>
  Effect.andThen(
    Effect.sync(() => console.error(`[tagma] the update this start belongs to cannot be judged without ${held.path}: ${held.reason}`)),
    left(),
  );

export const arrival = Effect.fn('composition.arrival')(function* (channel: Channel) {
  const store = databasePathIn(channel, process.env);
  const installRoot = installationRootIn(channel, process.env);
  if (Result.isFailure(store) || Result.isFailure(installRoot)) return;
  const place = trialPlace({
    installRoot: installRoot.success,
    release: holdingProcess(process.execPath) ?? undefined,
    storePath: store.success,
  });
  const arrived = yield* arrive(place).pipe(Effect.catchTag('InstallHeld', unlocked));
  if (arrived === 'serve') return;
  if (arrived === 'stale') {
    const open = readAttempt(installRoot.success);
    console.error(
      `[tagma] ${place.release ?? 'this build'} is not the release that stands: ${open?.to ?? 'another release'} stands as the update from ${open?.from ?? 'nothing'}, and only those two open its data until that update ends`,
    );
    return yield* left();
  }
  const lock = yield* Effect.result(lockDataDirectory(storeDirectory(store.success)));
  if (Result.isFailure(lock)) {
    console.error(`[tagma] the failed attempt waits for its data directory to be free: ${detailOf(lock.failure)}`);
    return yield* left();
  }
  yield* rollBack(place, `it started ${ATTEMPT_STARTS} times and never opened its door`).pipe(
    Effect.catchTag('InstallHeld', unlocked),
    Effect.ensuring(lock.success.release),
  );
  return yield* left();
});

export const attemptOf = Effect.fn('composition.attempt')(function* (at: AttemptPlace) {
  const place = trialPlace(at);
  const door = yield* Deferred.make<void>();
  const opened = Deferred.await(door);
  const arrived = Effect.asVoid(Deferred.done(door, Exit.void));
  const trial = yield* enterTrial(place).pipe(
    Effect.catchTag('TrialRefused', (refused) => Effect.andThen(rollBack(place, refused.detail, refused.words), left())),
    Effect.catchTag('StartStale', (stale) =>
      Effect.andThen(
        Effect.sync(() => console.error(`[tagma] ${stale.detail}`)),
        left(),
      ),
    ),
    Effect.catchTag('InstallHeld', unlocked),
  );
  if (trial === null) return { trial: null, opened, open: arrived } satisfies Arrival;
  entered = trial;
  const uncaught = (error: unknown): void => {
    console.error('[tagma] the server failed before its door opened:', error);
    Effect.runFork(startFailed(error).pipe(Effect.ensuring(left())));
  };
  const failedBeforeDoor = (error: unknown, done: () => void): void => {
    Effect.runFork(startFailed(error).pipe(Effect.ensuring(Effect.sync(done))));
  };
  process.on('uncaughtException', uncaught);
  process.on('unhandledRejection', uncaught);
  process.on(FAILED_BEFORE_DOOR, failedBeforeDoor);
  const open = Effect.andThen(
    Effect.suspend(() => {
      process.off('uncaughtException', uncaught);
      process.off('unhandledRejection', uncaught);
      process.off(FAILED_BEFORE_DOOR, failedBeforeDoor);
      return trial.passed;
    }),
    arrived,
  );
  return { trial, opened, open } satisfies Arrival;
});
