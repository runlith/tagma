import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Data, Effect } from 'effect';
import type { Words } from '../platform/contract/wire/refusal.js';
import { freeBytes, gigabytes, requireFree, SpaceShort, standingAt, treeBytes } from '../platform/durable/space.js';
import { holdDirectory } from '../platform/lock/directoryLease.js';
import { clearReturn, liveAttempt, openAttempt, readAttempt, readReturn } from '../installation/closure/attempt.js';
import { refusalDetail, verifyInstallation } from '../installation/closure/read.js';
import { currentVersion, publishStaged, swapCurrent } from '../installation/closure/versions.js';
import { manifestAt, releaseAt, releaseIdentified } from '../installation/closure/manifests.js';
import { compareReleases, isRelease } from '../installation/contract/wire/feed.js';
import { claimLeased, type InstallHeld, pruneReleases, withInstallLock } from '../installation/closure/leases.js';
import type { Applications } from '../installation/contract/service/applications.js';
import type { HostVerdict } from '../installation/contract/service/steps.js';
import { type InstallationManifest, releaseApplication } from '../installation/contract/wire/manifest.js';
import { writeLauncherBeside } from '../installation/setup/launcher.js';
import { RELEASE_INSIDE, RUNTIME_PART } from '../installation/contract/wire/layout.js';
import { ATTEMPT_OPEN } from '../installation/contract/wire/attempt.js';
import { EXECUTIONS_RUNTIME } from '../installation/contract/wire/archive.js';
import { noWayBackTo } from './offers.js';

export class ReleaseNotInstalled extends Data.TaggedError('ReleaseNotInstalled')<{
  readonly step: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly words?: Words;
  readonly code?: string;
}> {}

export type Landed = {
  readonly status: 'landed';
  readonly version: string;
  readonly root: string;
  readonly build: string;
  readonly previous: string | null;
  readonly application: string;
  readonly launcher: string;
};

export type Asked = {
  readonly status: 'ask';
  readonly reason: 'stepped-back' | 'irreversible' | 'failed';
  readonly said: string;
};

export type Held = {
  readonly status: 'held';
  readonly version: string;
  readonly root: string;
  readonly build: string;
  readonly standing: string | null;
  readonly detail: string;
};

export type Weigh = (root: string) => Effect.Effect<HostVerdict>;

export type InstallPlace = {
  readonly installRoot: string;
  readonly launcher: string;
  readonly name: string;
};

const AGAIN = ['tagma release update — download the release again'];
const SPACE_MARGIN = 1.25;
const LOCK_PATIENCE_MS = 600_000;
const DAMAGED: Words = { text: 'This copy of Tagma is damaged. Download Tagma again and open the new copy.' };
const UNFINISHED: Words = { text: 'Tagma could not finish installing this update. Try again.' };

const spaceWords = (needed: number): Words => ({
  text: `Not enough free space: Tagma needs ${gigabytes(needed)}. Free some space, then try again.`,
});

const refused = (step: string, reason: string, words?: Words) => new ReleaseNotInstalled({ step, reason, unblock: AGAIN, words });

const failedAt = (step: string) => (cause: unknown) =>
  cause instanceof SpaceShort
    ? refused('space', `${step}: ${cause.message}`, spaceWords(cause.needed))
    : refused(step, cause instanceof Error ? cause.message : String(cause));

const attempt = <A>(step: string, work: () => A): Effect.Effect<A, ReleaseNotInstalled> => Effect.try({ try: work, catch: failedAt(step) });

export const provenRelease = Effect.fn('release.prove')(function* (dir: string) {
  const manifest = yield* verifyInstallation(dir, [EXECUTIONS_RUNTIME]).pipe(
    Effect.mapError((failure) => refused('verify', refusalDetail(failure), DAMAGED)),
  );
  const digestOf = (path: string) => manifest.parts.find((part) => part.path === path)?.digest;
  const carried = digestOf(EXECUTIONS_RUNTIME);
  if (carried !== undefined && carried !== digestOf(RUNTIME_PART)) {
    return yield* refused(
      'verify',
      `${EXECUTIONS_RUNTIME} is named ${carried}, and the ${RUNTIME_PART} it is cloned from differs`,
      DAMAGED,
    );
  }
  return manifest;
});

const cloneRuntime = (dir: string, manifest: InstallationManifest): void => {
  if (!manifest.parts.some((part) => part.path === EXECUTIONS_RUNTIME)) return;
  const runtime = join(dir, RUNTIME_PART);
  const carried = join(dir, EXECUTIONS_RUNTIME);
  if (spawnSync('/bin/cp', ['-c', runtime, carried], { stdio: 'ignore' }).status === 0) return;
  requireFree(dir, statSync(runtime).size);
  copyFileSync(runtime, carried);
  chmodSync(carried, 0o700);
};

const cloneInto = (from: string, to: string): void => {
  if (spawnSync('/bin/cp', ['-Rc', `${from}/.`, to], { stdio: 'ignore' }).status === 0) return;
  requireFree(to, treeBytes(from));
  cpSync(from, to, { recursive: true, verbatimSymlinks: true, force: true });
};

const copyBytes = (bundle: string, installRoot: string): number =>
  statSync(bundle).dev === statSync(standingAt(installRoot)).dev ? 0 : treeBytes(bundle);

const spaced = (bundle: string, installRoot: string): Effect.Effect<void, ReleaseNotInstalled> =>
  Effect.flatMap(
    attempt('space', () => ({ needed: copyBytes(bundle, installRoot) * SPACE_MARGIN, free: freeBytes(installRoot) })),
    ({ needed, free }) =>
      free >= needed
        ? Effect.void
        : Effect.fail(
            refused(
              'space',
              `copying ${bundle} needs about ${gigabytes(needed)} free in ${installRoot}, and ${gigabytes(free)} stand free`,
              spaceWords(needed),
            ),
          ),
  );

const olderThan = (standing: string | undefined, offered: string): boolean =>
  standing !== undefined && isRelease(standing) && isRelease(offered) && compareReleases(offered, standing) < 0;

const askOf = (installRoot: string, offered: InstallationManifest, standing: string | undefined): Asked | null => {
  const build = offered.identity.build;
  const last = readAttempt(installRoot);
  if (last !== null && last.ended !== null && releaseAt(installRoot, last.to)?.identity.digest === offered.identity.digest) {
    return {
      status: 'ask',
      reason: 'failed',
      said: `Tagma ${build} did not start last time${standing === undefined ? '' : `, so you stayed on ${standing}`}. Try it again?`,
    };
  }
  const back = readReturn(installRoot);
  if (back !== null) {
    return {
      status: 'ask',
      reason: 'stepped-back',
      said: `You went back from Tagma ${back.left} to ${standing ?? 'the earlier version'}. Update to ${build} again?`,
    };
  }
  if (standing !== undefined && noWayBackTo(offered.irreversible ?? [], standing, build) !== null) {
    return {
      status: 'ask',
      reason: 'irreversible',
      said: `Once Tagma ${build} runs, you cannot go back to ${standing}. Update anyway?`,
    };
  }
  return null;
};

const held = Effect.fn('release.reuse')(function* (installRoot: string, digest: string) {
  const known = releaseIdentified(digest, installRoot);
  if (known === null) return null;
  const root = join(installRoot, known);
  const verified = yield* Effect.result(verifyInstallation(root));
  if (verified._tag === 'Failure') {
    yield* Effect.logDebug('an installed release did not verify, so it is not reused', verified.failure);
    return null;
  }
  const release = holdDirectory(root);
  return release === null ? null : { version: known, root, release };
});

const pruned = (installRoot: string, keep: readonly string[], applications: Applications): Effect.Effect<void> =>
  Effect.flatMap(Effect.exit(attempt('prune', () => pruneReleases(installRoot, keep, applications.forget))), (exit) =>
    exit._tag === 'Success'
      ? Effect.void
      : Effect.logWarning('the releases left beside the one that stands were not all removed', exit.cause),
  );

const lockRefusal = (failure: InstallHeld): ReleaseNotInstalled =>
  refused(
    'lock',
    `${failure.path}: ${failure.reason}`,
    failure.busy ? { text: 'Tagma is still installing another update. Try again when it finishes.' } : UNFINISHED,
  );

const placed = Effect.fn('release.place')(function* (
  dir: string,
  carrier: string,
  place: InstallPlace,
  applications: Applications,
  at: Date,
  asking: boolean,
  weigh: Weigh,
) {
  const { installRoot } = place;
  const read = manifestAt(dir);
  if (read._tag !== 'Read') return yield* refused('verify', `${dir} holds no installation manifest that reads`, DAMAGED);
  const offered = read.manifest;
  const standing = currentVersion(installRoot);
  const standingRelease = standing === null ? undefined : releaseAt(installRoot, standing);
  const standingBuild = standingRelease?.identity.build;
  if (olderThan(standingBuild, offered.identity.build)) {
    return yield* new ReleaseNotInstalled({
      step: 'order',
      reason: `release ${offered.identity.build} is older than release ${standingBuild}, which stands here`,
      unblock: [`open the application of release ${standingBuild}`, 'tagma release back — the one way down'],
      words: { text: `This copy of Tagma ${offered.identity.build} is older than Tagma ${standingBuild}, which you use.` },
    });
  }
  const live = liveAttempt(installRoot);
  if (live !== null && live.starts > 0) {
    return yield* new ReleaseNotInstalled({
      step: 'attempt',
      code: ATTEMPT_OPEN,
      reason: `release ${live.to} has started ${live.starts} time(s) as the update from ${live.from ?? 'nothing'} and has not opened its door or rolled back yet`,
      unblock: ['start the server of current: it finishes the update or rolls it back', 'then install-from again'],
      words: { text: 'Tagma is still finishing the last update. Open Tagma, then try again.' },
    });
  }
  const from = live === null ? standing : live.from;
  const moving = standingRelease?.identity.digest !== offered.identity.digest;
  const asked = asking && moving ? askOf(installRoot, offered, standingBuild) : null;
  if (asked !== null) return asked;
  const unsigned = yield* Effect.promise((signal) => applications.verify(carrier, signal));
  if (unsigned !== null) return yield* refused('signature', unsigned, DAMAGED);
  const manifest = yield* provenRelease(dir);
  if (manifest.platform.os !== process.platform || manifest.platform.arch !== process.arch) {
    return yield* new ReleaseNotInstalled({
      step: 'platform',
      reason: `this release was built for ${manifest.platform.os}/${manifest.platform.arch} and the installing process is ${process.platform}/${process.arch}`,
      unblock: ['run install-from with the runtime carried by this release'],
      words: { text: 'This copy of Tagma is made for another kind of Mac. Download the one for this Mac.' },
    });
  }
  const reused = yield* held(installRoot, manifest.identity.digest);
  if (reused === null || !existsSync(releaseApplication(reused.root, place.name))) yield* spaced(carrier, installRoot);
  const claimed = reused ?? (yield* attempt('place', () => claimLeased(installRoot, at)));
  const written = Effect.gen(function* () {
    const kept = releaseApplication(claimed.root, place.name);
    if (!existsSync(kept)) {
      yield* Effect.tryPromise({ try: () => applications.copy(carrier, kept), catch: failedAt('application') });
    }
    if (reused === null) {
      yield* attempt('place', () => {
        cloneInto(join(kept, RELEASE_INSIDE), claimed.root);
        cloneRuntime(claimed.root, manifest);
      });
    }
    const quarantined = yield* Effect.promise(() => applications.unquarantine(claimed.root));
    if (quarantined !== null) return yield* refused('quarantine', `${claimed.root} stays quarantined: ${quarantined}`, UNFINISHED);
    yield* writeLauncherBeside(installRoot, place.launcher, manifest.platform).pipe(
      Effect.mapError((failure) => refused('launcher', `${failure.path}: ${failure.detail}`, UNFINISHED)),
    );
    return reused === null ? yield* attempt('place', () => publishStaged(installRoot, claimed.version, at)) : reused.version;
  }).pipe(
    Effect.onError(() => Effect.sync(() => (reused === null ? rmSync(claimed.root, { recursive: true, force: true }) : undefined))),
    Effect.ensuring(Effect.sync(claimed.release)),
  );
  const version = yield* written;
  const verdict = version === standing ? null : yield* weigh(join(installRoot, version));
  if (verdict?._tag === 'Refuses') {
    return {
      status: 'held',
      version,
      root: join(installRoot, version),
      build: manifest.identity.build,
      standing: standingBuild ?? null,
      detail: verdict.detail,
    } satisfies Held;
  }
  yield* attempt('current', () => {
    applications.clearPlace(installRoot);
    if (version === standing) return;
    openAttempt(installRoot, from, version);
    clearReturn(installRoot);
    swapCurrent(installRoot, version);
  });
  if (version !== standing)
    yield* pruned(installRoot, [version, ...(from === null ? [] : [from]), ...(standing === null ? [] : [standing])], applications);
  return {
    status: 'landed',
    version,
    root: join(installRoot, version),
    build: manifest.identity.build,
    previous: version === standing ? null : standing,
    application: releaseApplication(join(installRoot, version), place.name),
    launcher: place.launcher,
  } satisfies Landed;
});

export const installRelease = Effect.fn('release.install')(function* (
  dir: string,
  place: InstallPlace,
  applications: Applications,
  at: Date,
  asking: boolean,
  weigh: Weigh,
) {
  const carrier = applications.carrier(dir);
  if (carrier === null) return yield* refused('carrier', `${dir} is not the release inside an application bundle`);
  return yield* withInstallLock(place.installRoot, LOCK_PATIENCE_MS, placed(dir, carrier, place, applications, at, asking, weigh)).pipe(
    Effect.mapError((failure) => (failure instanceof ReleaseNotInstalled ? failure : lockRefusal(failure))),
  );
});
