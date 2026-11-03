import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Data, Effect, Result } from 'effect';
import type { Words } from '../platform/contract/wire/refusal.js';
import { type CloneFailed, cloneTree } from '../platform/durable/clone.js';
import { freeBytes, gigabytes, SpaceShort, standingAt, treeBytes } from '../platform/durable/space.js';
import { holdDirectory } from '../platform/lock/directoryLease.js';
import { readAttempt, readReturn, type RecordUnreadable } from '../installation/closure/attempt.js';
import { refusalDetail, verifyInstallation } from '../installation/closure/read.js';
import { currentVersion } from '../platform/lock/versionedDirectories.js';
import { manifestAt, releaseAt, releaseIdentified } from '../installation/closure/manifests.js';
import { compareReleases, isRelease } from '../installation/contract/wire/feed.js';
import { claimLeased } from '../installation/closure/leases.js';
import {
  type AttemptStanding,
  type InstallHeld,
  type InstallLock,
  madeCurrent,
  type Move,
  type MoveFailed,
  moveFrom,
  moving,
  published,
} from '../installation/closure/moves.js';
import type { ApplicationNotCopied, Applications } from '../installation/contract/service/applications.js';
import type { HostVerdict } from '../installation/contract/service/steps.js';
import type { InstallationManifest } from '../installation/contract/wire/manifest.js';
import { writeLauncherBeside } from '../installation/setup/launcher.js';
import { RUNTIME_PART } from '../installation/contract/wire/layout.js';
import { ATTEMPT_OPEN } from '../installation/contract/wire/attempt.js';
import { EXECUTIONS_RUNTIME } from '../installation/contract/wire/archive.js';
import type { Asked, Held, Landed } from '../installation/contract/wire/placement.js';
import { noWayBackTo } from './offers.js';

export class ReleaseNotInstalled extends Data.TaggedError('ReleaseNotInstalled')<{
  readonly step: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly words?: Words;
  readonly code?: string;
}> {}

export type Weigh = (root: string) => Effect.Effect<HostVerdict>;

export type InstallPlace = {
  readonly installRoot: string;
  readonly launcher: string;
  readonly name: string;
};

const AGAIN = ['tagma release update — download the release again'];
const SPACE_MARGIN = 1.25;
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

const placingRefusal =
  (step: string) =>
  (failure: CloneFailed | ApplicationNotCopied): ReleaseNotInstalled =>
    failure.needed === undefined
      ? refused(step, failure.message)
      : refused('space', `${step}: ${failure.message}`, spaceWords(failure.needed));

const cloneRefusal = placingRefusal('place');

const copyRefusal = placingRefusal('application');

const cloneRuntime = (dir: string, manifest: InstallationManifest): Effect.Effect<void, CloneFailed> =>
  manifest.parts.some((part) => part.path === EXECUTIONS_RUNTIME)
    ? cloneTree(join(dir, RUNTIME_PART), join(dir, EXECUTIONS_RUNTIME))
    : Effect.void;

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

const askOf = Effect.fnUntraced(function* (installRoot: string, offered: InstallationManifest, standing: string | undefined) {
  const build = offered.identity.build;
  const last = yield* Effect.fromResult(readAttempt(installRoot)).pipe(Effect.mapError(attemptRefusal));
  if (last !== null && last.ended !== null && releaseAt(installRoot, last.to)?.identity.digest === offered.identity.digest) {
    return {
      status: 'ask',
      reason: 'failed',
      said: `Tagma ${build} did not start last time${standing === undefined ? '' : `, so you stayed on ${standing}`}. Try it again?`,
    } satisfies Asked;
  }
  const returned = readReturn(installRoot);
  const back = yield* Result.match(returned, {
    onSuccess: Effect.succeed,
    onFailure: (unreadable) =>
      Effect.as(
        Effect.logWarning(`${unreadable.message}; it holds no data and no release, so the install only skips asking about the step back`),
        null,
      ),
  });
  if (back !== null) {
    return {
      status: 'ask',
      reason: 'stepped-back',
      said: `You went back from Tagma ${back.left} to ${standing ?? 'the earlier version'}. Update to ${build} again?`,
    } satisfies Asked;
  }
  if (standing !== undefined && noWayBackTo(offered.irreversible ?? [], standing, build) !== null) {
    return {
      status: 'ask',
      reason: 'irreversible',
      said: `Once Tagma ${build} runs, you cannot go back to ${standing}. Update anyway?`,
    } satisfies Asked;
  }
  return null;
});

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

const lockRefusal = (failure: InstallHeld): ReleaseNotInstalled => refused('lock', `${failure.path}: ${failure.reason}`, UNFINISHED);

const moveRefusal = (failure: MoveFailed): ReleaseNotInstalled => refused(failure.step, failure.detail, UNFINISHED);

const STILL_FINISHING: Words = { text: 'Tagma is still finishing the last update. Open Tagma, then try again.' };

const attemptRefusal = (failure: AttemptStanding | RecordUnreadable): ReleaseNotInstalled =>
  failure._tag === 'RecordUnreadable'
    ? new ReleaseNotInstalled({
        step: 'attempt',
        code: ATTEMPT_OPEN,
        reason: `${failure.message}, so what the last update holds is unknown and nothing installs over it`,
        unblock: [
          'start the server of current: its start sets the record aside with the data copies it may name',
          'then install-from again',
        ],
        words: STILL_FINISHING,
      })
    : new ReleaseNotInstalled({
        step: 'attempt',
        code: ATTEMPT_OPEN,
        reason:
          failure.attempt.ended === null
            ? `release ${failure.attempt.to} has started ${failure.attempt.starts} time(s) as the update from ${failure.attempt.from ?? 'nothing'} and has not opened its door or rolled back yet`
            : `release ${failure.attempt.to} ended before its door opened, and the data from before it has not come back yet: ${failure.attempt.ended.detail}`,
        unblock: ['start the server of current: it finishes the update or rolls it back', 'then install-from again'],
        words: STILL_FINISHING,
      });

type Prepared = {
  readonly status: 'prepared';
  readonly version: string;
  readonly build: string;
  readonly standingBuild: string | null;
  readonly move: Move;
  readonly release: () => void;
};

const placed = Effect.fn('release.place')(function* (
  lock: InstallLock,
  dir: string,
  carrier: string,
  place: InstallPlace,
  applications: Applications,
  at: Date,
  asking: boolean,
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
  const move = yield* moveFrom(lock).pipe(Effect.mapError(attemptRefusal));
  const changing = standingRelease?.identity.digest !== offered.identity.digest;
  const asked = asking && changing ? yield* askOf(installRoot, offered, standingBuild) : null;
  if (asked !== null) return asked;
  const unsigned = yield* applications.verify(carrier);
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
  if (reused === null || !existsSync(applications.kept(reused.root, place.name))) yield* spaced(carrier, installRoot);
  const claimed = reused ?? (yield* attempt('place', () => claimLeased(installRoot, at)));
  const written = Effect.gen(function* () {
    const kept = applications.kept(claimed.root, place.name);
    if (!existsSync(kept)) yield* applications.copy(carrier, kept).pipe(Effect.mapError(copyRefusal));
    if (reused === null) {
      yield* cloneTree(applications.inside(kept), claimed.root).pipe(Effect.mapError(cloneRefusal));
      yield* cloneRuntime(claimed.root, manifest).pipe(Effect.mapError(cloneRefusal));
    }
    const quarantined = yield* applications.unquarantine(claimed.root);
    if (quarantined !== null) return yield* refused('quarantine', `${claimed.root} stays quarantined: ${quarantined}`, UNFINISHED);
    yield* writeLauncherBeside(installRoot, place.launcher, manifest.platform).pipe(
      Effect.mapError((failure) => refused('launcher', `${failure.path}: ${failure.detail}`, UNFINISHED)),
    );
    return reused === null ? yield* published(lock, claimed).pipe(Effect.mapError(moveRefusal)) : reused.version;
  }).pipe(
    Effect.onError(() =>
      Effect.sync(() => {
        if (reused === null) rmSync(claimed.root, { recursive: true, force: true });
        claimed.release();
      }),
    ),
  );
  const version = yield* written;
  return {
    status: 'prepared',
    version,
    build: manifest.identity.build,
    standingBuild: standingBuild ?? null,
    move,
    release: claimed.release,
  } satisfies Prepared;
});

const landedOn = Effect.fn('release.land')(function* (
  lock: InstallLock,
  prepared: Prepared,
  place: InstallPlace,
  applications: Applications,
) {
  const { version, move } = prepared;
  const now = yield* moveFrom(lock).pipe(Effect.mapError(attemptRefusal));
  if (now.standing !== move.standing || now.from !== move.from) {
    return yield* new ReleaseNotInstalled({
      step: 'current',
      code: 'current-moved',
      reason: `${now.standing ?? 'nothing'} stands now where ${move.standing ?? 'nothing'} stood while release ${prepared.build} was asked about its host`,
      unblock: ['install-from again: it decides from what stands now'],
      words: UNFINISHED,
    });
  }
  const left = yield* madeCurrent(lock, version, now, true, applications.forget).pipe(Effect.mapError(moveRefusal));
  if (left !== null) yield* Effect.logWarning(left);
  return {
    status: 'landed',
    version,
    root: join(place.installRoot, version),
    build: prepared.build,
    previous: version === now.from ? null : now.from,
    application: applications.kept(join(place.installRoot, version), place.name),
    launcher: place.launcher,
  } satisfies Landed;
});

const landing = Effect.fn('release.weigh')(function* (prepared: Prepared, place: InstallPlace, applications: Applications, weigh: Weigh) {
  const { installRoot } = place;
  const { version } = prepared;
  const verdict = version === prepared.move.standing ? null : yield* weigh(join(installRoot, version));
  if (verdict?._tag === 'Refuses') {
    return {
      status: 'held',
      version,
      root: join(installRoot, version),
      build: prepared.build,
      standing: prepared.standingBuild,
      detail: verdict.detail,
    } satisfies Held;
  }
  return yield* moving(installRoot, (lock) => landedOn(lock, prepared, place, applications));
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
  const settled = Effect.gen(function* () {
    const prepared = yield* moving(place.installRoot, (lock) => placed(lock, dir, carrier, place, applications, at, asking));
    if (prepared.status === 'ask') return prepared;
    return yield* landing(prepared, place, applications, weigh).pipe(Effect.ensuring(Effect.sync(prepared.release)));
  });
  return yield* settled.pipe(Effect.mapError((failure) => (failure instanceof ReleaseNotInstalled ? failure : lockRefusal(failure))));
});
