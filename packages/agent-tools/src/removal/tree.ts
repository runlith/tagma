import { dirname, join } from 'node:path';
import { Effect, type PlatformError } from 'effect';
import type { Entries, Listed } from '@runlith/files/entries';
import { type Entry, sameEntryVersion } from '@runlith/files/replace';
import type { ResolvedToolOptions } from '../workspace';
import { realParent, withNamedEntries } from '../workspace/runtime';
import { type DirectoryReplaced, removalIssue, sameDirectory } from './execute';
import { CHUNK, inOrder, LANES, type Leaf, type Outcome, removeLeaves } from './leaves';
import type { RemovalIssue, RemovalOptions, RemovalResult, RemovalTarget } from './model';
import { lastNames } from './order';
import { issueOf } from './selection';

type Frame = {
  readonly path: string;
  readonly entry: Entry;
  readonly operands: readonly string[];
  readonly children: readonly Listed[];
  readonly parent: Frame | undefined;
  at: number;
};

export type Settled = (row: RemovalResult, root: boolean) => Effect.Effect<void, PlatformError.PlatformError>;

const ordered = (listed: readonly Listed[]): readonly Listed[] => [
  ...listed.filter((one) => !lastNames.includes(one.name)),
  ...lastNames.flatMap((name) => listed.filter((one) => one.name === name)),
];

const plain = (child: Listed): boolean => child.kind !== null && child.kind !== 'directory' && !lastNames.includes(child.name);

const within = (path: string, directory: string): boolean => path === directory || path.startsWith(`${directory}/`);

export const removeTree = Effect.fn('DeleteTool.removeTree')(function* (
  resolved: ResolvedToolOptions,
  entries: Entries,
  root: RemovalTarget,
  options: RemovalOptions,
  nested: ReadonlyMap<string, readonly string[]>,
  settled: Settled,
  progress: (removed: number) => void,
) {
  const device = root.entry.kind === 'link' ? undefined : root.entry.info.dev;
  let removed = 0;
  const stack: Frame[] = [];
  let pending: { leaf: Leaf; frame: Frame }[] = [];
  let closing: Frame[] = [];
  const abandoned = new Set<string>();

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

  const settle = (leaf: Leaf, outcome: Outcome) => {
    if (outcome.status === 'failed') return failed(leaf.path, leaf.kind, leaf.operands, outcome.issue, false);
    removed += 1;
    progress(removed);
    return settled(
      {
        path: leaf.path,
        kind: leaf.kind,
        operands: leaf.operands,
        status: 'removed',
        record: outcome.record,
        issue:
          outcome.pending === null
            ? undefined
            : { path: leaf.path, stage: 'record', code: 'confirmation-pending', reason: outcome.pending },
      },
      false,
    );
  };

  const abandon = Effect.fnUntraced(function* (replaced: DirectoryReplaced) {
    abandoned.add(replaced.directory);
    pending = pending.filter(({ leaf }) => !within(leaf.path, replaced.directory));
    closing = closing.filter((frame) => !within(frame.path, replaced.directory));
    const at = stack.findIndex((frame) => frame.path === replaced.directory);
    if (at !== -1) stack.splice(at);
    const isRoot = replaced.directory === root.path;
    yield* failed(
      replaced.directory,
      'directory',
      nested.get(replaced.directory) ?? root.operands,
      { path: replaced.directory, stage: 'resolve', code: 'file-changed', reason: replaced.message },
      isRoot,
    );
  });

  const open = Effect.fnUntraced(function* (path: string, entry: Entry, operands: readonly string[], parent: Frame | undefined) {
    const listing = yield* Effect.result(entries.list(path));
    if (listing._tag === 'Success') return { path, entry, operands, children: ordered(listing.success), parent, at: 0 } satisfies Frame;
    yield* failed(path, entry.kind, operands, issueOf(path, 'read', listing.failure), parent === undefined);
    return undefined;
  });

  const closed = (frame: Frame, outcome: { readonly issue: RemovalIssue } | null) => {
    const isRoot = frame.parent === undefined;
    if (outcome !== null) return failed(frame.path, frame.entry.kind, frame.operands, outcome.issue, isRoot);
    removed += 1;
    progress(removed);
    return settled(
      {
        path: frame.path,
        kind: frame.entry.kind,
        operands: frame.operands,
        status: 'removed',
        record: 'outside',
        removed: isRoot ? removed : undefined,
      },
      isRoot,
    );
  };

  const rmdirOf = Effect.fnUntraced(function* (frame: Frame) {
    const directory = dirname(frame.path);
    if (frame.parent === undefined && (yield* realParent(frame.path)) !== directory)
      return {
        issue: {
          path: frame.path,
          stage: 'resolve',
          code: 'file-changed',
          reason: `${directory} no longer names the directory holding ${frame.path}. It was not removed.`,
        },
      } satisfies { readonly issue: RemovalIssue };
    const actual = yield* entries.at(frame.path);
    if (!sameEntryVersion(frame.entry, actual))
      return {
        issue: {
          path: frame.path,
          stage: 'resolve',
          code: actual === undefined ? 'not-found' : 'file-changed',
          reason: `${frame.path} changed after selection. This entry was not removed.`,
        },
      } satisfies { readonly issue: RemovalIssue };
    const gone = yield* Effect.result(entries.rmdir(frame.path));
    return gone._tag === 'Failure' ? { issue: removalIssue(frame.path, 'rmdir', gone.failure) } : null;
  });

  const closeWave = Effect.fnUntraced(function* (wave: readonly Frame[]) {
    const act = Effect.gen(function* () {
      const parents = [...new Set(wave.flatMap((frame) => (frame.parent === undefined ? [] : [frame.parent])))];
      for (const parent of parents) {
        const standing = yield* Effect.result(sameDirectory(entries, parent.path, parent.entry));
        if (standing._tag === 'Failure') {
          if (standing.failure._tag !== 'DirectoryReplaced') return yield* standing.failure;
          yield* abandon(standing.failure);
        }
      }
      const ready = wave.filter((frame) => ![...abandoned].some((directory) => within(frame.path, directory)));
      const done = inOrder(ready, closed);
      yield* Effect.forEach(
        ready,
        (frame, at) =>
          Effect.uninterruptible(
            rmdirOf(frame).pipe(
              Effect.matchEffect({
                onFailure: (failure) => done(at, { issue: removalIssue(frame.path, 'resolve', failure) }),
                onSuccess: (outcome) => done(at, outcome),
              }),
            ),
          ),
        { concurrency: LANES, discard: true },
      );
    });
    return yield* withNamedEntries(
      [...new Set(wave.map((frame) => dirname(frame.path)))],
      wave.map((frame) => frame.path),
      act,
    );
  });

  const flush = Effect.gen(function* () {
    const batch = pending;
    pending = [];
    if (batch.length > 0) {
      const frames = [...new Set(batch.map(({ frame }) => frame))];
      const replaced = yield* removeLeaves({
        resolved,
        entries,
        directories: frames,
        leaves: batch.map(({ leaf }) => leaf),
        settle,
      });
      for (const one of replaced) yield* abandon(one);
    }
    const closes = closing;
    closing = [];
    const waves: Frame[][] = [];
    for (const [at, frame] of closes.entries()) {
      const before = closes[at - 1];
      if (before === undefined || within(before.path, frame.path)) waves.push([frame]);
      else waves.at(-1)!.push(frame);
    }
    for (const wave of waves) yield* closeWave(wave);
  });

  const add = Effect.fnUntraced(function* (leaf: Leaf, frame: Frame) {
    pending.push({ leaf, frame });
    if (pending.length >= CHUNK) yield* flush;
  });

  const top = yield* open(root.path, root.entry, root.operands, undefined);
  if (top === undefined) return;
  stack.push(top);
  while (stack.length !== 0) {
    const frame = stack.at(-1)!;
    if (frame.at >= frame.children.length) {
      stack.pop();
      closing.push(frame);
      if (pending.length === 0) yield* flush;
      continue;
    }
    const first = frame.children[frame.at]!;
    frame.at += 1;
    const path = join(frame.path, first.name);
    const operands = nested.get(path) ?? frame.operands;
    if (plain(first)) {
      yield* add({ path, kind: first.kind!, expected: null, operands }, frame);
      continue;
    }
    if (lastNames.includes(first.name)) yield* flush;
    const [read, parent, listing] = yield* Effect.all(
      [
        Effect.result(entries.at(path)),
        Effect.result(sameDirectory(entries, frame.path, frame.entry)),
        first.kind === 'directory'
          ? Effect.map(Effect.result(entries.list(path)), (one) => one as typeof one | null)
          : Effect.succeed(null),
      ],
      { concurrency: 3 },
    );
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
      yield* add({ path, kind: entry.kind, expected: null, operands }, frame);
      if (lastNames.includes(first.name)) yield* flush;
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
    if (parent._tag === 'Failure') {
      if (parent.failure._tag === 'DirectoryReplaced') yield* abandon(parent.failure);
      else yield* failed(path, entry.kind, operands, issueOf(frame.path, 'read', parent.failure), false);
      continue;
    }
    const listed = listing ?? (yield* Effect.result(entries.list(path)));
    if (listed._tag === 'Failure') {
      yield* failed(path, entry.kind, operands, issueOf(path, 'read', listed.failure), false);
      continue;
    }
    stack.push({ path, entry, operands, children: ordered(listed.success), parent: frame, at: 0 });
  }
  yield* flush;
});
