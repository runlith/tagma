import { type FileHandle, mkdir, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Clock, Data, Effect } from 'effect';
import { closeOnExec, lockExclusive } from './flock';

const RETRY_START_MS = 25;
const RETRY_MAX_MS = RETRY_START_MS * 10;

export type LockHold = {
  readonly path: string;
  readonly handle: FileHandle;
  readonly inode: number;
};

export class LockUnavailable extends Data.TaggedError('LockUnavailable')<{
  readonly path: string;
  readonly reason: string;
}> {}

export class LockBusy extends Data.TaggedError('LockBusy')<{
  readonly path: string;
  readonly waitedMs: number;
}> {}

export class LockLost extends Data.TaggedError('LockLost')<{ readonly path: string }> {}

export type FileLockFailure = LockUnavailable | LockBusy | LockLost;

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const absent = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR');

const unavailable = (path: string) => (cause: unknown) => new LockUnavailable({ path, reason: reasonOf(cause) });

function openLockFile(path: string): Effect.Effect<LockHold, LockUnavailable> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      const handle = await open(path, 'a', 0o600);
      try {
        closeOnExec(handle.fd);
        return { path, handle, inode: (await handle.stat()).ino };
      } catch (cause) {
        await handle.close();
        throw cause;
      }
    },
    catch: unavailable(path),
  });
}

function closeLockFile(hold: LockHold): Effect.Effect<void, LockUnavailable> {
  return Effect.tryPromise({ try: () => hold.handle.close(), catch: unavailable(hold.path) });
}

function claim(hold: LockHold, waitMs: number): Effect.Effect<LockHold, LockUnavailable | LockBusy> {
  const attempt = Effect.try({ try: () => lockExclusive(hold.handle.fd), catch: unavailable(hold.path) });
  const loop = (startedAt: number, delayMs: number): Effect.Effect<LockHold, LockUnavailable | LockBusy> =>
    Effect.flatMap(attempt, (outcome) => {
      if (outcome === 'locked') return Effect.succeed(hold);
      return Effect.flatMap(Clock.currentTimeMillis, (now) => {
        const elapsed = now - startedAt;
        if (elapsed >= waitMs) return Effect.fail(new LockBusy({ path: hold.path, waitedMs: elapsed }));
        return Effect.sleep(Math.min(delayMs, waitMs - elapsed)).pipe(
          Effect.flatMap(() => loop(startedAt, Math.min(delayMs * 2, RETRY_MAX_MS))),
        );
      });
    });
  return Effect.flatMap(Clock.currentTimeMillis, (startedAt) => loop(startedAt, RETRY_START_MS));
}

export function withFileLock<A, E, R>(
  path: string,
  waitMs: number,
  body: (hold: LockHold) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | LockUnavailable | LockBusy, R> {
  return Effect.acquireUseRelease(openLockFile(path), (opened) => Effect.flatMap(claim(opened, waitMs), body), closeLockFile);
}

export function proveHold(hold: LockHold): Effect.Effect<void, LockLost | LockUnavailable> {
  return Effect.tryPromise({
    try: () => stat(hold.path),
    catch: (cause) => (absent(cause) ? new LockLost({ path: hold.path }) : unavailable(hold.path)(cause)),
  }).pipe(Effect.flatMap((current) => (current.ino === hold.inode ? Effect.void : Effect.fail(new LockLost({ path: hold.path })))));
}
