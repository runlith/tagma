import { Data, Effect, PlatformError } from 'effect';
import { ToolFailed } from '@runlith/agent/tool';
import type { Entries } from '@runlith/files/entries';
import { type Entry, fileFailure, sameEntryVersion } from '@runlith/files/replace';
import type { PreparedPath, ResolvedToolOptions } from '../workspace';
import { admitPreparedPath } from '../workspace/runtime';
import type { RemovalIssue, RemovalStage, RemovalTarget } from './model';

export function removalIssue(path: string, stage: RemovalStage, failure: unknown): RemovalIssue {
  if (failure instanceof ToolFailed) return { path, stage, code: failure.code ?? 'tool-refused', reason: failure.reason };
  if (failure instanceof PlatformError.PlatformError) {
    const native: unknown = failure.reason.cause;
    const code = native !== null && typeof native === 'object' && 'code' in native ? String(native.code) : failure.reason._tag;
    const codes: Readonly<Record<string, string>> = {
      ENOENT: 'not-found',
      NotFound: 'not-found',
      ENOTDIR: 'not-directory',
      EISDIR: 'is-directory',
      ENOTEMPTY: 'directory-not-empty',
      EACCES: 'access-denied',
      EPERM: 'operation-not-permitted',
      EROFS: 'read-only-filesystem',
      EBUSY: 'busy',
      ELOOP: 'symlink-loop',
      PermissionDenied: 'access-denied',
    };
    const syscall = native !== null && typeof native === 'object' && 'syscall' in native ? String(native.syscall) : failure.reason.method;
    const stages: Readonly<Record<string, RemovalStage>> = {
      unlink: 'unlink',
      remove: 'unlink',
      rmdir: 'rmdir',
      realpath: 'resolve',
      lstat: 'resolve',
      open: 'read',
      read: 'read',
      readFile: 'read',
      scandir: 'read',
    };
    return { path, stage: stages[syscall] ?? stage, code: codes[code] ?? code, reason: fileFailure(failure) };
  }
  if (failure instanceof Error) return { path, stage, code: 'operation-failed', reason: failure.message };
  return { path, stage, code: 'operation-failed', reason: String(failure) };
}

export class DirectoryReplaced extends Data.TaggedError('DirectoryReplaced')<{ readonly directory: string; readonly message: string }> {}

export const sameDirectory = (entries: Entries, directory: string, opened: Entry) =>
  Effect.flatMap(entries.at(directory), (actual) =>
    sameEntryVersion(opened, actual)
      ? Effect.void
      : Effect.fail(
          new DirectoryReplaced({
            directory,
            message: `${directory} was replaced while it was being removed. Nothing more in it was removed.`,
          }),
        ),
  );

export const admitRoot = Effect.fn('DeleteTool.admitRoot')(function* (
  resolved: ResolvedToolOptions,
  entries: Entries,
  target: RemovalTarget,
  prepared: PreparedPath,
) {
  yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
  const actual = yield* entries.at(target.path);
  if (!sameEntryVersion(target.entry, actual))
    return yield* new ToolFailed({
      code: actual === undefined ? 'not-found' : 'file-changed',
      reason: `${target.path} changed after selection. This entry was not removed.`,
    });
});
