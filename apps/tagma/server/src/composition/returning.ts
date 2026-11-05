import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Data, Deferred, Effect, Exit, Layer, Result } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ACTIVITY_DATABASE } from '../activity/contract/service/place.js';
import { idleStates } from '../executions/host/idle.js';
import { mirrorsHome } from '../graph/storage/layout.js';
import { holdingProcess } from '../installation/closure/leases.js';
import { releaseAt } from '../installation/closure/manifests.js';
import { Succession } from '../installation/contract/service/succession.js';
import type { Channel } from '../installation/contract/wire/channel.js';
import { HOST_REPLACE, HOST_STATE } from '../installation/contract/wire/launch.js';
import { SERVE_LOG, serveLogPath } from '../installation/contract/wire/layout.js';
import {
  ACTIVITY_MIGRATIONS,
  EVIDENCE_MIGRATIONS,
  EXECUTIONS,
  MIGRATIONS,
  STORE_MIGRATIONS,
} from '../installation/contract/wire/manifest.js';
import { RESTART_ID, RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { databasePathIn, installationRootIn } from '../installation/paths.js';
import { connectLaunch } from '../installation/process/launch.js';
import { makeProcessRestart } from '../installation/process/record.js';
import {
  type ReturnPlace,
  stepBackAsked,
  stepBackCarried,
  stepBackHanded,
  stepBackPassed,
  stepBackSettled,
  stepBackUnlisted,
  type StoreFile,
  storeUnfit,
} from '../installation/process/returning.js';
import { expectsRelease, replaced, serving, standBy, type StoodBy } from '../installation/process/standBy.js';
import { successionLayer } from '../installation/process/succession.js';
import { PERFORMANCE_DATABASE } from '../performance/contract/service/place.js';
import { ownStoreDirectory } from '../platform/contract/service/ownStore.js';
import { storeDirectory } from '../platform/contract/service/store.js';
import { type DataDirectoryLock, lockDataDirectory } from '../platform/lock/dataDirectory.js';
import { claimHoldersLayer } from './hostClaims.js';

const DATABASE = '.sqlite';

const databasesUnder = (directory: string): readonly string[] =>
  !existsSync(directory)
    ? []
    : readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const at = join(directory, entry.name);
        return entry.isDirectory() ? databasesUnder(at) : entry.name.endsWith(DATABASE) ? [at] : [];
      });

const ownStores = (storePath: string): readonly StoreFile[] => {
  const directory = ownStoreDirectory(storePath);
  return !existsSync(directory)
    ? []
    : readdirSync(directory)
        .filter((name) => name.endsWith(DATABASE) && statSync(join(directory, name)).isFile())
        .map((name) => ({ path: join(directory, name), chain: `${STORE_MIGRATIONS}/${name.slice(0, -DATABASE.length)}` }));
};

const returnedFiles = (storePath: string, hosts: readonly string[]): readonly StoreFile[] => {
  const data = storeDirectory(storePath);
  return [
    { path: storePath, chain: MIGRATIONS },
    { path: join(data, ACTIVITY_DATABASE), chain: ACTIVITY_MIGRATIONS },
    { path: join(data, PERFORMANCE_DATABASE), chain: EVIDENCE_MIGRATIONS },
    ...ownStores(storePath),
    ...databasesUnder(mirrorsHome(data)).map((path) => ({ path, chain: MIGRATIONS })),
    ...hosts.map((state) => ({ path: join(state, 'executions.sqlite'), chain: `${EXECUTIONS}/${MIGRATIONS}` })),
  ];
};

const returnPlace = (installRoot: string, release: string, storePath: string): Effect.Effect<ReturnPlace, PlatformError> =>
  Effect.map(idleStates(storePath).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, claimHoldersLayer))), (hosts) => ({
    installRoot,
    own: basename(release),
    ownRoot: release,
    files: () => returnedFiles(storePath, hosts.idle),
    kept: () => returnedFiles(storePath, hosts.every),
  }));

class StoresUnread extends Data.TaggedError('StoresUnread')<{ readonly detail: string }> {}

export const storesUnfitFor = (storePath: string, successorRoot: string): Effect.Effect<string | null, StoresUnread> =>
  Effect.try({
    try: () => storeUnfit(returnedFiles(storePath, []), successorRoot),
    catch: (cause) => new StoresUnread({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });

export const stepBackSettledAt = (installRoot: string, release: string, storePath: string) =>
  Effect.flatMap(returnPlace(installRoot, release, storePath), stepBackSettled).pipe(
    Effect.catchTag('PlatformError', (failure) =>
      Effect.sync(() =>
        console.error(
          `[tagma] the step back that stands waits for its next start: the execution hosts could not be listed: ${failure.message}`,
        ),
      ),
    ),
    Effect.catchTag('MoveFailed', (failed) =>
      Effect.sync(() => console.error(`[tagma] the step back that stands waits for its next start: ${failed.step}: ${failed.detail}`)),
    ),
    Effect.catchTag('InstallHeld', (held) =>
      Effect.sync(() => console.error(`[tagma] the step back that stands waits for its next start: ${held.path}: ${held.reason}`)),
    ),
    Effect.catchTag('StepBackFailed', (failed) =>
      Effect.sync((): never => {
        console.error(`[tagma] this start does not open the data: ${failed.detail}`);
        return process.exit(1);
      }),
    ),
  );

export const returnedBeforeServing = Effect.fn('composition.returning')(function* (channel: Channel) {
  const store = databasePathIn(channel, process.env);
  const installRoot = installationRootIn(channel, process.env);
  if (Result.isFailure(store) || Result.isFailure(installRoot)) return;
  const release = holdingProcess(process.execPath);
  if (release === null) return;
  const asked = stepBackAsked(installRoot.success, basename(release));
  if (asked === null) return;
  const storePath = store.success;
  const data = storeDirectory(storePath);
  const manifest = releaseAt(installRoot.success, basename(release));
  if (manifest == null) return;
  const listed = yield* Effect.result(returnPlace(installRoot.success, release, storePath));
  if (Result.isFailure(listed)) return yield* stepBackUnlisted(installRoot.success, asked, listed.failure);
  const place = listed.success;
  const predecessor = replaced(process.env);
  const notified = expectsRelease(process.env);
  delete process.env[HOST_STATE];
  delete process.env[HOST_REPLACE];
  const incoming = process.env[RESTART_ID];
  delete process.env[RESTART_ID];
  const launch = connectLaunch(process.env);
  const stood = yield* Effect.result(
    predecessor === undefined
      ? Effect.map(lockDataDirectory(data), (lock): StoodBy => ({ lock, unreleased: null }))
      : standBy(data, predecessor, notified, launch?.chained ?? true),
  );
  const alone = predecessor === undefined && launch === undefined;
  if (Result.isFailure(stood)) {
    console.error(`[tagma] the step back waits for its data directory to be free: ${String(stood.failure)}`);
    if (alone) return;
    return yield* Effect.sync((): never => process.exit(1));
  }
  const lock: DataDirectoryLock = stood.success.lock;
  const record = yield* makeProcessRestart({ path: join(data, RESTART_RECORD), pid: process.pid, incoming });
  if (predecessor !== undefined) record.receive(predecessor);
  record.load();
  record.start(yield* Clock.currentTimeMillis);
  const carried = yield* stepBackCarried(place, asked);
  if (!carried && alone) return yield* lock.release;
  if (launch !== undefined && notified) yield* serving(true);
  const stoodBy = yield* Deferred.make<void>();
  const log = serveLogPath(channel, process.env) ?? join(data, SERVE_LOG);
  const succession = Context.get(
    yield* Layer.build(
      successionLayer(
        { root: release, manifest },
        installRoot.success,
        log,
        (root) => root,
        () => Deferred.doneUnsafe(stoodBy, Exit.void),
        launch,
        record,
        undefined,
        undefined,
        undefined,
        undefined,
        stood.success.chain ?? null,
      ),
    ),
    Succession,
  );
  const handed = yield* Effect.result(succession.restart());
  if (handed._tag === 'Failure') {
    if (carried) yield* stepBackHanded(place, asked, handed.failure.detail);
    if (alone) return yield* lock.release;
    console.error(`[tagma] pid ${process.pid} leaves for whoever started it to raise a server again: ${handed.failure.detail}`);
    return yield* Effect.sync((): never => process.exit(1));
  }
  const stopped = (): never => process.exit(1);
  process.once('SIGTERM', stopped);
  yield* Deferred.await(stoodBy);
  process.off('SIGTERM', stopped);
  yield* lock.release;
  yield* succession.release(null).pipe(Effect.orDie);
  yield* succession.settle.pipe(Effect.orDie);
  if (carried) yield* stepBackPassed(place, asked);
  if (notified && launch === undefined) yield* serving(true);
  return yield* Effect.sync((): never => process.exit(0));
}, Effect.scoped);
