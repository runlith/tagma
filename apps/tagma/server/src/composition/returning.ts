import { basename, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Data, Deferred, Effect, Exit, Layer, Result } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { idleStates } from '../executions/host/idle.js';
import { holdingProcess } from '../installation/closure/leases.js';
import type { PendingUnreadable } from '../installation/closure/pending.js';
import { releaseAt } from '../installation/closure/manifests.js';
import { Succession, type SuccessorLaunch } from '../installation/contract/service/succession.js';
import { HOST_REPLACE, HOST_STATE } from '../installation/contract/wire/launch.js';
import { SERVE_LOG, serveLogPath } from '../installation/contract/wire/layout.js';
import { RESTART_ID, RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { databasePathIn, installationRootIn } from '../installation/paths.js';
import { connectLaunch } from '../installation/process/launch.js';
import { makeProcessRestart } from '../installation/process/record.js';
import {
  asidesReleased,
  installedSince,
  JOURNAL_STARTS,
  journalsDeferred,
  journalsMarked,
  type ReturnPlace,
  stepBackAsked,
  stepBackCarried,
  stepBackDecided,
  stepBackHanded,
  stepBackPassed,
  stepBackSettled,
  stepBackUnlisted,
  stepsCarried,
  storeUnfit,
} from '../installation/process/returning.js';
import type { StepBack } from '../installation/contract/wire/stepBack.js';
import { expectsRelease, replaced, serving, standBy, type StoodBy } from '../installation/process/standBy.js';
import { successionLayer } from '../installation/process/succession.js';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { storeDirectory } from '../platform/contract/service/store.js';
import { type DataDirectoryLock, lockDataDirectory } from '../platform/lock/dataDirectory.js';
import type { ThreadRollouts } from '../threads/contract/service/rollouts.js';
import type { Build } from './build.js';
import { dataStores, fillsOf, type StoreFills } from './dataStores.js';
import { claimHoldersLayer } from './hostClaims.js';

const returnPlace = (
  installRoot: string,
  release: string,
  storePath: string,
  fills?: StoreFills,
): Effect.Effect<ReturnPlace, PlatformError> =>
  Effect.map(idleStates(storePath).pipe(Effect.provide(Layer.merge(BunFileSystem.layer, claimHoldersLayer))), (hosts) => ({
    installRoot,
    own: basename(release),
    ownRoot: release,
    files: () => dataStores(storePath, hosts.idle, fills),
    kept: () => dataStores(storePath, hosts.every),
  }));

class StoresUnread extends Data.TaggedError('StoresUnread')<{ readonly detail: string }> {}

export const storesUnfitFor = (storePath: string, successorRoot: string): Effect.Effect<string | null, StoresUnread> =>
  Effect.try({
    try: () => storeUnfit(dataStores(storePath, []), successorRoot),
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

export const returnedBeforeServing = Effect.fn('composition.returning')(function* (build: Build) {
  const store = databasePathIn(build.channel, process.env);
  const installRoot = installationRootIn(build.channel, process.env);
  if (Result.isFailure(store) || Result.isFailure(installRoot)) return;
  const release = holdingProcess(process.execPath);
  if (release === null) return;
  const asked = stepBackAsked(installRoot.success, basename(release));
  if (asked === null) {
    const released = yield* Effect.result(Effect.try(() => asidesReleased(installRoot.success, release, dataStores(store.success, []))));
    if (Result.isFailure(released)) console.error(`[tagma] what migrations kept aside stays where it lies: ${String(released.failure)}`);
    else
      for (const file of released.success)
        console.error(`[tagma] ${file} is released: every standing installation carries the migration that kept it`);
    return;
  }
  const storePath = store.success;
  const data = storeDirectory(storePath);
  const manifest = releaseAt(installRoot.success, basename(release));
  if (manifest == null) return;
  if (asked.journals?.returned !== true) {
    const starts = asked.journals?.starts ?? 0;
    if (starts < JOURNAL_STARTS) {
      const deferred = yield* Effect.result(journalsDeferred(installRoot.success, asked));
      if (Result.isFailure(deferred)) {
        console.error(`[tagma] this start's server returns the threads without counting the start: ${String(deferred.failure)}`);
        return;
      }
      if (deferred.success) return;
    } else
      console.error(
        `[tagma] the threads ${basename(release)} wrote stay in its form: its server started ${starts} times without returning them to ${asked.to}`,
      );
  }
  const parts = yield* Effect.result(Effect.tryPromise(build.parts));
  if (Result.isFailure(parts))
    console.error(`[tagma] the stores return without their index fills: the modules could not be read: ${String(parts.failure)}`);
  const fills = Result.isSuccess(parts) ? fillsOf(parts.success.modules) : undefined;
  const listed = yield* Effect.result(returnPlace(installRoot.success, release, storePath, fills));
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
  const log = serveLogPath(build.channel, process.env) ?? join(data, SERVE_LOG);
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
  if (carried && launch !== undefined) yield* stepBackDecided(installRoot.success, asked);
  if (carried) yield* stepBackPassed(place, asked);
  if (notified && launch === undefined) yield* serving(true);
  return yield* Effect.sync((): never => process.exit(0));
}, Effect.scoped);

export type JournalsServing = {
  readonly installRoot: string;
  readonly release: string;
  readonly handoff: Effect.Effect<Succession['Service'], PendingUnreadable>;
  readonly modules: readonly Manifest[];
  readonly rollouts: ThreadRollouts['Service'];
  readonly launch: SuccessorLaunch | undefined;
  readonly notified: boolean;
};

export const journalsServed = Effect.fn('composition.journalsServed')(function* (handing: JournalsServing) {
  const asked = stepBackAsked(handing.installRoot, basename(handing.release));
  if (asked === null || asked.journals?.returned === true) return null;
  const succession = yield* handing.handoff;
  return (yield* journalsHanded(handing, asked, succession)) ? succession : null;
});

const journalsHanded = Effect.fnUntraced(function* (handing: JournalsServing, asked: StepBack, succession: Succession['Service']) {
  const { installRoot, release } = handing;
  const names = handing.modules.flatMap((module) => (module.formSteps ?? []).map((step) => step.name));
  const returned = yield* Effect.result(
    handing.rollouts.returnOnto({ carried: stepsCarried(join(installRoot, asked.to), names), since: installedSince(release) }),
  );
  if (Result.isFailure(returned))
    console.error(`[tagma] the threads ${basename(release)} wrote did not all return to ${asked.to}: ${String(returned.failure)}`);
  else {
    const { threads, kept, unreturned } = returned.success;
    console.error(`[tagma] ${threads} threads returned to the form ${asked.to} reads`);
    if (kept.length > 0) console.error(`[tagma] the form steps ${kept.join(', ')} declare no way back, so their records stay as they are`);
    for (const left of unreturned)
      console.error(`[tagma] the thread ${left.threadId} stays in the form ${basename(release)} wrote: ${left.reason}`);
  }
  const marked = yield* Effect.result(journalsMarked(installRoot, asked, true));
  if (Result.isFailure(marked)) {
    console.error(
      `[tagma] the threads' return to ${asked.to} was not recorded, so the next start returns them again: ${String(marked.failure)}`,
    );
    return false;
  }
  if (!marked.success) return false;
  if (handing.launch !== undefined && handing.notified) yield* serving(true);
  const handed = yield* Effect.result(succession.restart());
  if (Result.isSuccess(handed)) return true;
  console.error(`[tagma] the step back to ${asked.to} waits for the next start: ${handed.failure.detail}`);
  const unmarked = yield* Effect.result(journalsMarked(installRoot, asked, false));
  if (Result.isFailure(unmarked) || !unmarked.success)
    console.error(
      `[tagma] the threads this build writes from now on may stay in its form after the step back: the return could not be unmarked: ${Result.isFailure(unmarked) ? String(unmarked.failure) : 'the step back changed'}`,
    );
  return false;
});
