import { join } from 'node:path';
import { LockBusy, LockUnavailable, withFileLock } from '@runlith/file-lock/FileLock';
import { Clock, Data, Effect, Result } from 'effect';
import { holdDirectory } from '../../platform/lock/directoryLease.js';
import type { Attempt } from '../contract/wire/attempt.js';
import { INSTALL_LOCK } from '../contract/wire/layout.js';
import {
  beginAttempt,
  clearReturn,
  clearStepBack,
  type RecordUnreadable,
  servedRelease,
  standingAttempt,
  writeReturn,
  writeStepBack,
} from './attempt.js';
import { type Claimed, claimLeased, pruneReleases } from './leases.js';
import { releaseAt } from './manifests.js';
import { currentVersion, swapCurrent } from '../../platform/lock/versionedDirectories.js';
import { previousRelease, publishStaged } from './versions.js';

export class InstallHeld extends Data.TaggedError('InstallHeld')<{ readonly path: string; readonly reason: string }> {}

export class AttemptStanding extends Data.TaggedError('AttemptStanding')<{ readonly attempt: Attempt }> {}

export class MoveFailed extends Data.TaggedError('MoveFailed')<{ readonly step: string; readonly detail: string }> {}

class PreviousMissing extends Data.TaggedError('PreviousMissing')<{
  readonly root: string;
  readonly standing: string | null;
  readonly expected: string | null;
}> {}

export type InstallLock = { readonly root: string };

export type Move = { readonly standing: string | null; readonly from: string | null };

const detailOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const done = <A>(step: string, work: () => A): Effect.Effect<A, MoveFailed> =>
  Effect.try({ try: work, catch: (cause) => new MoveFailed({ step, detail: detailOf(cause) }) });

export const moving = <A, E, R>(root: string, work: (lock: InstallLock) => Effect.Effect<A, E, R>): Effect.Effect<A, E | InstallHeld, R> =>
  withFileLock(join(root, INSTALL_LOCK), Number.POSITIVE_INFINITY, () => work({ root })).pipe(
    Effect.mapError((failure) =>
      failure instanceof LockUnavailable
        ? new InstallHeld({ path: failure.path, reason: failure.reason })
        : failure instanceof LockBusy
          ? new InstallHeld({ path: failure.path, reason: `another installation held it for ${failure.waitedMs} ms` })
          : failure,
    ),
    Effect.withSpan('installation.moving'),
  );

export const moveFrom = Effect.fnUntraced(function* (lock: InstallLock): Effect.fn.Return<Move, AttemptStanding | RecordUnreadable> {
  const standing = currentVersion(lock.root);
  const attempt = yield* Effect.fromResult(standingAttempt(lock.root));
  if (attempt === null) return { standing, from: (yield* Effect.fromResult(servedRelease(lock.root))) ?? standing };
  if (attempt.starts > 0 || attempt.ended !== null) return yield* new AttemptStanding({ attempt });
  return { standing, from: attempt.from };
});

export const staging = (root: string): Effect.Effect<Claimed, MoveFailed | InstallHeld> =>
  moving(root, () => Effect.flatMap(Clock.currentTimeMillis, (now) => done('stage', () => claimLeased(root, new Date(now)))));

export const published = Effect.fn('installation.publish')(function* (lock: InstallLock, staged: Claimed) {
  const now = yield* Clock.currentTimeMillis;
  return yield* done('publish', () => publishStaged(lock.root, staged.version, new Date(now)));
});

export const madeCurrent = Effect.fn('installation.makeCurrent')(function* (
  lock: InstallLock,
  version: string,
  move: Move,
  attempted: boolean,
  forget: (dir: string) => void,
) {
  if (version === move.standing) return null;
  yield* done('current', () => {
    if (attempted) beginAttempt(lock.root, move.from, version);
    clearReturn(lock.root);
    clearStepBack(lock.root);
    swapCurrent(lock.root, version);
  });
  const kept = [version, ...(move.from === null ? [] : [move.from])];
  const pruned = yield* Effect.result(done('prune', () => pruneReleases(lock.root, kept, forget)));
  return Result.isSuccess(pruned) ? null : `the releases beside ${version} were not all removed: ${pruned.failure.detail}`;
});

type Chosen = { readonly standing: string; readonly previous: string; readonly release: () => void };

const chosenBack = Effect.fnUntraced(function* (lock: InstallLock, expected: string | null) {
  const { root } = lock;
  yield* moveFrom(lock);
  const standing = currentVersion(root);
  const previous = previousRelease(root);
  if (standing === null || previous === null || (expected !== null && previous !== expected)) {
    return yield* new PreviousMissing({ root, standing, expected });
  }
  const release = yield* done('lease', () => holdDirectory(join(root, previous)));
  if (release === null) return yield* new PreviousMissing({ root, standing, expected });
  return { standing, previous, release } satisfies Chosen;
});

const askedBack = Effect.fnUntraced(function* (lock: InstallLock, chosen: Chosen, running: string | null) {
  const { root } = lock;
  const { standing, previous } = chosen;
  yield* moveFrom(lock);
  if (currentVersion(root) !== standing || previousRelease(root) !== previous) {
    return yield* new PreviousMissing({ root, standing: currentVersion(root), expected: previous });
  }
  yield* done('current', () => {
    clearStepBack(root);
    if (running === previous) {
      writeReturn(root, releaseAt(root, standing)?.identity.build ?? standing, previous);
      swapCurrent(root, previous);
    } else writeStepBack(root, { from: standing, to: previous, carried: false });
  });
  return { version: previous, root: join(root, previous), from: standing, build: releaseAt(root, previous)?.identity.build ?? null };
});

export const steppedBack = <E, R>(
  root: string,
  expected: string | null,
  running: string | null,
  before: Effect.Effect<void, E, R>,
  undo: Effect.Effect<void>,
) =>
  moving(root, (lock) => chosenBack(lock, expected)).pipe(
    Effect.flatMap((chosen) =>
      Effect.andThen(before, moving(root, (lock) => askedBack(lock, chosen, running)).pipe(Effect.onError(() => undo))).pipe(
        Effect.ensuring(Effect.sync(chosen.release)),
      ),
    ),
    Effect.withSpan('installation.stepBack'),
  );

export const carriedOnto = Effect.fn('installation.stepBackCarried')(function* (
  lock: InstallLock,
  back: { readonly from: string; readonly to: string },
  leaving: string,
) {
  const { root } = lock;
  yield* done('current', () => {
    writeStepBack(root, { from: back.from, to: back.to, carried: true });
    beginAttempt(root, leaving, back.to);
    writeReturn(root, releaseAt(root, leaving)?.identity.build ?? leaving, back.to);
    swapCurrent(root, back.to);
  });
});

export const undoneOnto = Effect.fn('installation.stepBackUndone')(function* (lock: InstallLock, leaving: string) {
  const { root } = lock;
  yield* done('current', () => {
    clearReturn(root);
    swapCurrent(root, leaving);
  });
});

export const backAskedOnto = Effect.fn('installation.stepBackAsked')(function* (lock: InstallLock, leaving: string, onto: string) {
  const { root } = lock;
  yield* done('current', () => {
    clearReturn(root);
    swapCurrent(root, leaving);
    writeStepBack(root, { from: leaving, to: onto, carried: false });
  });
});
