import type { FileHandle } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { Data, Effect } from 'effect';

export type FileStamp = { readonly modifiedAt: number; readonly size: number; readonly inode: number };

export class FileStatFailed extends Data.TaggedError('FileStatFailed')<{
  readonly code?: string;
  readonly reason: string;
}> {}

class FileCloseFailed extends Data.TaggedError('FileCloseFailed')<{
  readonly reason: string;
}> {}

export function isNodeError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause;
}

export function causeReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function sameStamp(left: FileStamp | null, right: FileStamp | null): boolean {
  if (left === null || right === null) return left === right;
  return left.modifiedAt === right.modifiedAt && left.size === right.size && left.inode === right.inode;
}

export const statPath = (path: string): Effect.Effect<FileStamp | null, FileStatFailed> =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      new FileStatFailed({
        code: isNodeError(cause) ? cause.code : undefined,
        reason: causeReason(cause),
      }),
  }).pipe(
    Effect.map((value) => ({ modifiedAt: value.mtimeMs, size: value.size, inode: value.ino })),
    Effect.catch((failure) => (failure.code === 'ENOENT' ? Effect.succeed(null) : Effect.fail(failure))),
    Effect.withSpan('CredentialFile.statPath'),
  );

export const closeQuietly = (handle: FileHandle): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => handle.close(),
    catch: (cause) => new FileCloseFailed({ reason: causeReason(cause) }),
  }).pipe(
    Effect.asVoid,
    Effect.catch(() => Effect.succeed(undefined)),
  );
