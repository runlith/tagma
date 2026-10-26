import { dirname } from 'node:path';
import { ByteSize, Clock, Data, Effect, FileSystem, PlatformError } from 'effect';
import { ToolFailed } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { type Entry, entryAt, fileFailure, removeEntry, removedEntry, replaced, sameEntryVersion } from '@runlith/files/replace';
import { BINARY_PROBE, bytesDigest, contentDigest, contentOf, filePrefix, withBom } from '@runlith/files/content';
import { inTurn, landing, recording, type Recorded } from '../changed';
import type { IntakeRefused } from '../WorkspaceChanges';
import type { PreparedPath, ResolvedToolOptions } from '../workspace';
import { admitPreparedPath, realParent, withDirectoryLock, withFileWriteLock, withNamedEntry } from '../workspace/runtime';
import { filePatch } from '../display';
import { orAbsent } from '../namespace';
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
      open: 'read',
      read: 'read',
      readFile: 'read',
    };
    return { path, stage: stages[syscall] ?? stage, code: codes[code] ?? code, reason: fileFailure(failure) };
  }
  return { path, stage, code: 'operation-failed', reason: failure instanceof Error ? failure.message : String(failure) };
}

const recordsAt = (resolved: ResolvedToolOptions, path: string): Effect.Effect<boolean, IntakeRefused> => {
  const changes = resolved.changes;
  if (changes === undefined) return Effect.succeed(false);
  return changes.records === undefined ? Effect.succeed(true) : changes.records(path, 'entry');
};

const lossAt = Effect.fn('DeleteTool.lossAt')(function* (path: string, info: FileSystem.File.Info) {
  const fs = yield* FileSystem.FileSystem;
  const probe = yield* orAbsent(filePrefix(fs, path, BINARY_PROBE));
  if (probe === undefined) return undefined;
  const prefix = contentOf(probe, { partial: probe.byteLength === BINARY_PROBE && info.size > ByteSize.bytes(BINARY_PROBE) });
  if (prefix.kind !== 'text') return { kind: 'entry' as const, probe };
  const bytes = info.size <= ByteSize.bytes(BINARY_PROBE) ? probe : yield* orAbsent(fs.readFile(path));
  if (bytes === undefined) return undefined;
  const decoded = bytes === probe ? prefix : contentOf(bytes);
  return decoded.kind === 'text' ? { kind: 'text' as const, bytes, text: withBom(decoded) } : { kind: 'unlined' as const, bytes };
});

export type RemovedTarget = { readonly record: Recorded; readonly display?: ToolDisplay };

export type Committed = (removed: RemovedTarget) => Effect.Effect<void, PlatformError.PlatformError>;

const changedSince = (path: string, actual: Entry | undefined) =>
  new ToolFailed({
    code: actual === undefined ? 'not-found' : 'file-changed',
    reason: `${path} changed after selection. This entry was not removed.`,
  });

const removal = Effect.fnUntraced(function* (
  resolved: ResolvedToolOptions,
  path: string,
  entry: Entry,
  recorded: boolean,
  single: boolean,
  stage: (next: RemovalStage) => void,
  committed: Committed,
) {
  const commit = <E, R>(act: Effect.Effect<RemovedTarget, E, R>) => Effect.uninterruptible(Effect.tap(act, committed));
  const actual = yield* entryAt(path);
  if (!sameEntryVersion(entry, actual)) return yield* changedSince(path, actual);
  if (entry.kind === 'directory' || !recorded) {
    stage(entry.kind === 'directory' ? 'rmdir' : 'unlink');
    return yield* commit(
      Effect.gen(function* () {
        const removed = yield* removeEntry(path, entry);
        if (!removed) return yield* new ToolFailed({ code: 'file-changed', reason: `${path} no longer names the selected entry.` });
        return { record: { kept: false, pending: null } };
      }),
    );
  }
  if (entry.kind === 'link') {
    stage('record');
    return yield* commit(
      Effect.map(recording(resolved, 'delete', path, { standing: { link: entry.target }, before: '', after: '' }), (record) => ({
        record,
      })),
    );
  }
  if (entry.kind === 'special') {
    stage('record');
    return yield* commit(
      Effect.map(
        landing(
          resolved,
          [{ origin: 'delete', target: 'entry', path, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest('') }],
          Effect.suspend(() => {
            stage('unlink');
            return removeEntry(path, entry);
          }),
        ),
        (record) => ({ record }),
      ),
    );
  }
  stage('read');
  const loss = yield* lossAt(path, entry.info);
  if (loss === undefined)
    return yield* new ToolFailed({ code: 'file-changed', reason: `${path} vanished before its contents could be read.` });
  stage('record');
  if (loss.kind === 'entry') {
    return yield* commit(
      Effect.map(
        landing(
          resolved,
          [{ origin: 'delete', target: 'entry', path, at: new Date(yield* Clock.currentTimeMillis), after: contentDigest('') }],
          Effect.suspend(() => {
            stage('unlink');
            return removedEntry(path, entry.info, loss.probe);
          }),
        ),
        (record) => ({ record }),
      ),
    );
  }
  if (loss.kind === 'unlined') {
    return yield* commit(
      Effect.map(
        landing(
          resolved,
          [
            {
              origin: 'delete',
              target: 'entry',
              path,
              at: new Date(yield* Clock.currentTimeMillis),
              before: bytesDigest(loss.bytes),
              after: contentDigest(''),
            },
          ],
          Effect.suspend(() => {
            stage('unlink');
            return replaced(path, { bytes: loss.bytes }, null, { resource: path, selected: entry });
          }),
        ),
        (record) => ({ record }),
      ),
    );
  }
  return yield* commit(
    Effect.map(
      recording(resolved, 'delete', path, {
        standing: { bytes: loss.bytes },
        before: loss.text,
        after: '',
        resource: path,
        selected: entry,
      }),
      (record) => ({ record, display: single ? filePatch(resolved.cwd, path, loss.text, '') : undefined }),
    ),
  );
});

export const removeTarget = Effect.fn('DeleteTool.removeTarget')(function* (
  resolved: ResolvedToolOptions,
  target: RemovalTarget,
  prepared: PreparedPath,
  single: boolean,
  stage: (next: RemovalStage) => void,
  committed: Committed,
) {
  const path = target.path;
  const work = Effect.gen(function* () {
    stage('resolve');
    yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
    const recorded = target.entry.kind === 'directory' ? false : yield* recordsAt(resolved, path);
    return yield* removal(resolved, path, target.entry, recorded, single, stage, committed);
  });
  return yield* withNamedEntry(resolved.cwd, path, inTurn(resolved, path, work, 'entry'));
});

export const admitRoot = Effect.fn('DeleteTool.admitRoot')(function* (
  resolved: ResolvedToolOptions,
  target: RemovalTarget,
  prepared: PreparedPath,
) {
  yield* admitPreparedPath(resolved, prepared, { allowMissing: true });
  const actual = yield* entryAt(target.path);
  if (!sameEntryVersion(target.entry, actual)) return yield* changedSince(target.path, actual);
});

export class DirectoryReplaced extends Data.TaggedError('DirectoryReplaced')<{ readonly directory: string; readonly message: string }> {}

export const sameDirectory = Effect.fn('DeleteTool.sameDirectory')(function* (directory: string, opened: Entry) {
  if (!sameEntryVersion(opened, yield* entryAt(directory)))
    return yield* new DirectoryReplaced({
      directory,
      message: `${directory} was replaced while it was being removed. Nothing more in it was removed.`,
    });
});

export const removeWalked = Effect.fn('DeleteTool.removeWalked')(function* (
  resolved: ResolvedToolOptions,
  path: string,
  entry: Entry,
  opened: Entry | undefined,
  stage: (next: RemovalStage) => void,
  committed: Committed,
) {
  stage('resolve');
  const directory = dirname(path);
  const parent = opened === undefined ? Effect.void : sameDirectory(directory, opened);
  if (opened === undefined && (yield* realParent(path)) !== directory)
    return yield* new ToolFailed({
      code: 'file-changed',
      reason: `${directory} no longer names the directory holding ${path}. It was not removed.`,
    });
  const recorded = entry.kind === 'directory' ? false : yield* recordsAt(resolved, path);
  const act = Effect.andThen(parent, removal(resolved, path, entry, recorded, false, stage, committed));
  return yield* withDirectoryLock(directory, withFileWriteLock(resolved.cwd, path, recorded ? inTurn(resolved, path, act, 'entry') : act));
});
