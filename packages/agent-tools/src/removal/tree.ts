import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { entryAt, type Entry } from '@runlith/files/replace';
import type { ResolvedToolOptions } from '../workspace';
import { DirectoryReplaced, removalIssue, removeWalked, sameDirectory, type RemovedTarget } from './execute';
import type { RemovalIssue, RemovalOptions, RemovalResult, RemovalStage, RemovalTarget } from './model';
import { lastNames } from './order';
import { issueOf } from './selection';

type Frame = {
  readonly path: string;
  readonly entry: Entry;
  readonly operands: readonly string[];
  readonly names: readonly string[];
  at: number;
  readonly last: Set<string>;
};

export type Settled = (row: RemovalResult, root: boolean) => Effect.Effect<void, PlatformError>;

const recordOf = (removed: RemovedTarget): RemovalResult['record'] =>
  removed.record.pending !== null ? 'pending' : removed.record.kept ? 'recorded' : 'outside';

const nextName = (frame: Frame): string | undefined => {
  while (frame.at < frame.names.length) {
    const name = frame.names[frame.at++]!;
    if (!lastNames.includes(name)) return name;
    frame.last.add(name);
  }
  for (const name of lastNames) {
    if (!frame.last.delete(name)) continue;
    return name;
  }
  return undefined;
};

export const removeTree = Effect.fn('DeleteTool.removeTree')(function* (
  resolved: ResolvedToolOptions,
  root: RemovalTarget,
  options: RemovalOptions,
  nested: ReadonlyMap<string, readonly string[]>,
  settled: Settled,
  progress: (removed: number) => void,
) {
  const fs = yield* FileSystem.FileSystem;
  const device = root.entry.kind === 'link' ? undefined : root.entry.info.dev;
  let removed = 0;

  const failed = (path: string, kind: string, operands: readonly string[], issue: RemovalIssue, isRoot: boolean) =>
    settled(
      {
        path,
        kind,
        operands,
        status: options.force && issue.code === 'not-found' ? 'absent' : 'failed',
        issue,
        removed: isRoot ? removed : undefined,
      },
      isRoot,
    );

  const remove = Effect.fnUntraced(function* (
    path: string,
    entry: Entry,
    operands: readonly string[],
    opened: Entry | undefined,
    isRoot: boolean,
  ) {
    let stage: RemovalStage = 'resolve';
    let committed = false;
    yield* removeWalked(
      resolved,
      path,
      entry,
      opened,
      (next) => {
        stage = next;
      },
      (done) => {
        committed = true;
        removed += 1;
        progress(removed);
        return settled(
          {
            path,
            kind: entry.kind,
            operands,
            status: 'removed',
            record: recordOf(done),
            removed: isRoot ? removed : undefined,
            issue:
              done.record.pending === null
                ? undefined
                : { path, stage: 'record', code: 'confirmation-pending', reason: done.record.pending },
          },
          isRoot,
        );
      },
    ).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          committed || failure instanceof DirectoryReplaced
            ? Effect.fail(failure)
            : failed(path, entry.kind, operands, removalIssue(path, stage, failure), isRoot),
        onSuccess: () => Effect.void,
      }),
    );
  });

  const open = Effect.fnUntraced(function* (path: string, entry: Entry, operands: readonly string[], isRoot: boolean) {
    const listing = yield* Effect.result(fs.readDirectory(path));
    if (listing._tag === 'Success')
      return { path, entry, operands, names: listing.success, at: 0, last: new Set<string>() } satisfies Frame;
    yield* failed(path, entry.kind, operands, issueOf(path, 'read', listing.failure), isRoot);
    return undefined;
  });

  const top = yield* open(root.path, root.entry, root.operands, true);
  if (top === undefined) return;
  const stack: Frame[] = [top];
  const abandon = (replaced: DirectoryReplaced) => {
    const at = stack.findIndex((frame) => frame.path === replaced.directory);
    const frame = stack[at]!;
    stack.splice(at);
    return failed(
      frame.path,
      frame.entry.kind,
      frame.operands,
      { path: frame.path, stage: 'resolve', code: 'file-changed', reason: replaced.message },
      stack.length === 0,
    );
  };
  while (stack.length !== 0) {
    const frame = stack.at(-1)!;
    const name = nextName(frame);
    if (name === undefined) {
      stack.pop();
      yield* remove(frame.path, frame.entry, frame.operands, stack.at(-1)?.entry, stack.length === 0).pipe(
        Effect.catchTag('DirectoryReplaced', abandon),
      );
      continue;
    }
    const path = join(frame.path, name);
    const operands = nested.get(path) ?? frame.operands;
    const read = yield* Effect.result(entryAt(path));
    if (read._tag === 'Failure') {
      yield* failed(path, 'unknown', operands, issueOf(path, 'read', read.failure), false);
      continue;
    }
    const entry = read.success;
    if (entry === undefined) {
      yield* failed(
        path,
        'unknown',
        operands,
        { path, stage: 'read', code: 'not-found', reason: `${path} disappeared while its directory was being removed.` },
        false,
      );
      continue;
    }
    if (entry.kind !== 'directory') {
      yield* remove(path, entry, operands, frame.entry, false).pipe(Effect.catchTag('DirectoryReplaced', abandon));
      continue;
    }
    if (options.oneFileSystem && entry.info.dev !== device) {
      yield* settled(
        {
          path,
          kind: entry.kind,
          operands,
          status: 'skipped',
          issue: {
            path,
            stage: 'expand',
            code: 'filesystem-boundary',
            reason: `--one-file-system skips a directory on another device than ${root.path}.`,
          },
        },
        false,
      );
      continue;
    }
    const standing = yield* sameDirectory(frame.path, frame.entry).pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Effect.as(
            failure instanceof DirectoryReplaced
              ? abandon(failure)
              : failed(path, entry.kind, operands, issueOf(frame.path, 'read', failure), false),
            false,
          ),
        onSuccess: () => Effect.succeed(true),
      }),
    );
    if (!standing) continue;
    const child = yield* open(path, entry, operands, false);
    if (child !== undefined) stack.push(child);
  }
});
