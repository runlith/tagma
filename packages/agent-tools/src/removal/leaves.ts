import { dirname } from 'node:path';
import { ByteSize, Clock, Effect, FileSystem, type PlatformError, Result, Semaphore } from 'effect';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { WorkspaceChange } from '@runlith/files/change';
import { BINARY_PROBE, bytesDigest, contentDigest, contentOf, filePrefix, withBom } from '@runlith/files/content';
import type { Each, Entries, Gone, Removal } from '@runlith/files/entries';
import { type Entry, sameEntryVersion } from '@runlith/files/replace';
import { deletionOf, inTurns, landingEach } from '../changed';
import { filePatch } from '../display';
import { orAbsent } from '../namespace';
import type { ResolvedToolOptions } from '../workspace';
import { withNamedEntries } from '../workspace/runtime';
import { type DirectoryReplaced, removalIssue, sameDirectory } from './execute';
import type { RemovalIssue } from './model';

export const LANES = 4;

export const CHUNK = 1024;

const READ_SLICE = 64;

const READ_BYTES = 8 * 1024 * 1024;

const WHOLE_READ = 1024 * 1024;

export type Leaf = {
  readonly path: string;
  readonly kind: Entry['kind'];
  readonly expected: Entry | null;
  readonly operands: readonly string[];
};

export type Outcome =
  | { readonly status: 'removed'; readonly record: 'recorded' | 'outside' | 'pending'; readonly pending: string | null }
  | { readonly status: 'failed'; readonly issue: RemovalIssue };

export type Settle = (leaf: Leaf, outcome: Outcome) => Effect.Effect<void, PlatformError.PlatformError>;

type Shown = (leaf: Leaf, display: ToolDisplay) => void;

export type Opened = { readonly path: string; readonly entry: Entry };

type Loss = { readonly change: WorkspaceChange; readonly removal: Removal; readonly text?: string };

type Done<O = Outcome> = (at: number, outcome: O) => Effect.Effect<void, PlatformError.PlatformError>;

const outside: Outcome = { status: 'removed', record: 'outside', pending: null };

const failed = (path: string, stage: RemovalIssue['stage'], failure: unknown): Outcome => ({
  status: 'failed',
  issue: removalIssue(path, stage, failure),
});

const changed = (path: string, actual: Entry | undefined): Outcome => ({
  status: 'failed',
  issue: {
    path,
    stage: 'resolve',
    code: actual === undefined ? 'not-found' : 'file-changed',
    reason: `${path} changed after selection. This entry was not removed.`,
  },
});

const moved = (path: string): Outcome => ({
  status: 'failed',
  issue: { path, stage: 'record', code: 'file-changed', reason: `${path} changed after it was read. This entry was not removed.` },
});

const goneOutcome = (leaf: Leaf, gone: Result.Result<Gone, PlatformError.PlatformError>, removed: Outcome): Outcome =>
  gone._tag === 'Failure'
    ? failed(leaf.path, leaf.kind === 'directory' ? 'rmdir' : 'unlink', gone.failure)
    : gone.success === 'removed'
      ? removed
      : gone.success === 'absent'
        ? changed(leaf.path, undefined)
        : leaf.expected === null
          ? moved(leaf.path)
          : changed(leaf.path, leaf.expected);

const recordsOf = (resolved: ResolvedToolOptions, paths: readonly string[]) => {
  const changes = resolved.changes;
  if (changes === undefined) return Effect.succeed(paths.map(() => false));
  return changes.records === undefined ? Effect.succeed(paths.map(() => true)) : changes.records(paths, 'entry');
};

export const inOrder = <T, O>(
  items: readonly T[],
  settle: (item: T, outcome: O) => Effect.Effect<void, PlatformError.PlatformError>,
): Done<O> => {
  const outcomes: ({ readonly outcome: O } | undefined)[] = items.map(() => undefined);
  const draining = Semaphore.makeUnsafe(1);
  let next = 0;
  const drain = draining.withPermit(
    Effect.gen(function* () {
      while (next < items.length && outcomes[next] !== undefined) {
        const at = next++;
        yield* settle(items[at]!, outcomes[at]!.outcome);
      }
    }),
  );
  return (at, outcome) =>
    Effect.suspend(() => {
      outcomes[at] = { outcome };
      return drain;
    });
};

const lossOf = Effect.fnUntraced(function* (resolved: ResolvedToolOptions, path: string, entry: Entry, content: Uint8Array | null) {
  const at = new Date(yield* Clock.currentTimeMillis);
  if (entry.kind === 'link') {
    const kept = { link: entry.target };
    return { change: yield* deletionOf(resolved, path, kept, ''), removal: { path, selected: entry, kept } } satisfies Loss;
  }
  if (entry.kind !== 'file')
    return {
      change: { origin: 'delete', target: 'entry', path, at, after: contentDigest('') },
      removal: { path, selected: entry, kept: null },
    } satisfies Loss;
  const fs = yield* FileSystem.FileSystem;
  const whole = content !== null;
  const probe = content ?? (yield* orAbsent(filePrefix(fs, path, BINARY_PROBE)));
  if (probe === undefined) return undefined;
  const prefix = contentOf(probe, {
    partial: !whole && probe.byteLength === BINARY_PROBE && entry.info.size > ByteSize.bytes(BINARY_PROBE),
  });
  if (prefix.kind !== 'text')
    return {
      change: { origin: 'delete', target: 'entry', path, at, after: contentDigest('') },
      removal: { path, selected: entry, kept: { prefix: probe } },
    } satisfies Loss;
  const bytes = whole ? probe : yield* orAbsent(fs.readFile(path));
  if (bytes === undefined) return undefined;
  const decoded = bytes === probe ? prefix : contentOf(bytes);
  const removal: Removal = { path, selected: entry, kept: { bytes } };
  if (decoded.kind !== 'text')
    return {
      change: { origin: 'delete', target: 'entry', path, at, before: bytesDigest(bytes), after: contentDigest('') },
      removal,
    } satisfies Loss;
  const text = withBom(decoded);
  return { change: yield* deletionOf(resolved, path, { bytes }, text), removal, text } satisfies Loss;
});

const landGroup = Effect.fnUntraced(function* (
  resolved: ResolvedToolOptions,
  entries: Entries,
  ready: readonly { readonly leaf: Leaf; readonly at: number; readonly loss: Loss }[],
  done: Done,
  shown: Shown | undefined,
) {
  if (ready.length === 0) return;
  let gone: Each<Gone> = [];
  const written = yield* landingEach(
    resolved,
    ready.map(({ loss }) => loss.change),
    Effect.map(Effect.uninterruptible(entries.removeAll(ready.map(({ loss }) => loss.removal))), (each) => {
      gone = each;
      return each.map((one) => one._tag === 'Success' && one.success === 'removed');
    }),
  ).pipe(Effect.result);
  for (const [index, { leaf, at, loss }] of ready.entries()) {
    if (written._tag === 'Failure') {
      yield* done(at, failed(leaf.path, 'record', written.failure));
      continue;
    }
    const recorded = written.success[index];
    if (recorded === null || recorded === undefined) {
      const one = gone[index];
      yield* done(at, one === undefined ? moved(leaf.path) : goneOutcome(leaf, one, outside));
      continue;
    }
    if (loss.text !== undefined && shown !== undefined) shown(leaf, filePatch(resolved.cwd, leaf.path, loss.text, ''));
    yield* done(at, {
      status: 'removed',
      record: recorded.pending !== null ? 'pending' : recorded.kept ? 'recorded' : 'outside',
      pending: recorded.pending,
    });
  }
});

const landed = Effect.fnUntraced(function* (
  resolved: ResolvedToolOptions,
  entries: Entries,
  kept: readonly { readonly leaf: Leaf; readonly at: number }[],
  done: Done,
  shown: Shown | undefined,
  standing: (directories: ReadonlySet<string>) => Effect.Effect<ReadonlyMap<string, DirectoryReplaced>, PlatformError.PlatformError>,
) {
  let ready: { readonly leaf: Leaf; readonly at: number; readonly loss: Loss }[] = [];
  let bytes = 0;
  const land = (group: typeof ready) => Effect.uninterruptible(landGroup(resolved, entries, group, done, shown));
  for (let start = 0; start < kept.length; start += READ_SLICE) {
    const slice = kept.slice(start, start + READ_SLICE);
    const reads = yield* entries.readAll(
      slice.map(({ leaf }) => leaf.path),
      WHOLE_READ,
    );
    const replacedAt = yield* standing(new Set(slice.flatMap(({ leaf }) => (leaf.expected === null ? [dirname(leaf.path)] : []))));
    for (const [index, one] of slice.entries()) {
      const replaced = one.leaf.expected === null ? replacedAt.get(dirname(one.leaf.path)) : undefined;
      if (replaced !== undefined) {
        yield* done(one.at, {
          status: 'failed',
          issue: { path: one.leaf.path, stage: 'resolve', code: 'file-changed', reason: replaced.message },
        });
        continue;
      }
      const read = reads[index]!;
      if (read._tag === 'Failure') {
        yield* done(one.at, failed(one.leaf.path, 'read', read.failure));
        continue;
      }
      const { entry, bytes: content } = read.success;
      if (entry === undefined || (one.leaf.expected !== null && !sameEntryVersion(one.leaf.expected, entry))) {
        yield* done(one.at, changed(one.leaf.path, entry));
        continue;
      }
      const loss = yield* Effect.result(lossOf(resolved, one.leaf.path, entry, content));
      if (loss._tag === 'Failure') {
        yield* done(one.at, failed(one.leaf.path, 'read', loss.failure));
        continue;
      }
      if (loss.success === undefined) {
        yield* done(one.at, moved(one.leaf.path));
        continue;
      }
      ready.push({ ...one, loss: loss.success });
      bytes += entry.kind === 'file' ? Number(entry.info.size) : 0;
      if (bytes >= READ_BYTES) {
        yield* land(ready);
        ready = [];
        bytes = 0;
      }
    }
  }
  yield* land(ready);
});

export const removeLeaves = Effect.fn('DeleteTool.removeLeaves')(function* (input: {
  readonly resolved: ResolvedToolOptions;
  readonly entries: Entries;
  readonly directories: readonly Opened[];
  readonly leaves: readonly Leaf[];
  readonly settle: Settle;
  readonly shown?: Shown;
}) {
  const { resolved, entries, directories } = input;
  const replaced: DirectoryReplaced[] = [];
  if (input.leaves.length === 0) return replaced;
  const asked = input.leaves.filter((leaf) => leaf.kind !== 'directory');
  const answered = yield* Effect.result(
    recordsOf(
      resolved,
      asked.map((leaf) => leaf.path),
    ),
  );
  const askedAt = new Map(asked.map((leaf, at) => [leaf, at] as const));
  const classified = input.leaves.map((leaf): { readonly leaf: Leaf; readonly keeps: Result.Result<boolean, unknown> } => {
    const at = askedAt.get(leaf);
    if (at === undefined) return { leaf, keeps: Result.succeed(false) };
    return { leaf, keeps: answered._tag === 'Failure' ? Result.fail(answered.failure) : Result.succeed(answered.success[at] === true) };
  });
  const parents =
    directories.length === 0 ? [...new Set(input.leaves.map((leaf) => dirname(leaf.path)))] : directories.map((one) => one.path);
  const opened = new Map(directories.map((one) => [one.path, one.entry] as const));
  const away = new Map<string, DirectoryReplaced>();
  const standing = Effect.fnUntraced(function* (asked: ReadonlySet<string>) {
    for (const directory of asked) {
      const entry = opened.get(directory);
      if (entry === undefined || away.has(directory)) continue;
      const stands = yield* Effect.result(sameDirectory(entries, directory, entry));
      if (stands._tag === 'Success') continue;
      if (stands.failure._tag !== 'DirectoryReplaced') return yield* stands.failure;
      away.set(directory, stands.failure);
      replaced.push(stands.failure);
    }
    return away as ReadonlyMap<string, DirectoryReplaced>;
  });
  const work = Effect.gen(function* () {
    yield* standing(new Set(opened.keys()));
    const gone = new Set(replaced.map((one) => one.directory));
    const refused: { readonly leaf: Leaf; readonly outcome: Outcome }[] = [];
    const walked: Leaf[] = [];
    const selected: Leaf[] = [];
    const kept: Leaf[] = [];
    for (const { leaf, keeps } of classified) {
      if (gone.has(dirname(leaf.path))) continue;
      if (keeps._tag === 'Failure') refused.push({ leaf, outcome: failed(leaf.path, 'resolve', keeps.failure) });
      else if (keeps.success) kept.push(leaf);
      else (leaf.expected === null ? walked : selected).push(leaf);
    }
    const order = [...refused.map(({ leaf }) => leaf), ...walked, ...selected, ...kept];
    const done = inOrder(order, input.settle);
    for (const [at, { outcome }] of refused.entries()) yield* done(at, outcome);
    let at = refused.length;
    if (walked.length > 0) {
      const first = at;
      yield* Effect.uninterruptible(
        Effect.flatMap(entries.unlinkAll(walked.map((leaf) => leaf.path)), (each) =>
          Effect.forEach(
            walked,
            (leaf, index) => {
              const one = each[index]!;
              return done(first + index, one._tag === 'Success' ? outside : failed(leaf.path, 'unlink', one.failure));
            },
            { discard: true },
          ),
        ),
      );
    }
    at += walked.length;
    if (selected.length > 0) {
      const first = at;
      yield* Effect.uninterruptible(
        Effect.flatMap(entries.removeAll(selected.map((leaf) => ({ path: leaf.path, selected: leaf.expected!, kept: null }))), (each) =>
          Effect.forEach(selected, (leaf, index) => done(first + index, goneOutcome(leaf, each[index]!, outside)), { discard: true }),
        ),
      );
    }
    at += selected.length;
    if (kept.length > 0)
      yield* landed(
        resolved,
        entries,
        kept.map((leaf, index) => ({ leaf, at: at + index })),
        done,
        input.shown,
        standing,
      );
  });
  const locked = withNamedEntries(
    parents,
    input.leaves.map((leaf) => leaf.path),
    work,
  );
  const candidates = classified.flatMap(({ leaf, keeps }) => (keeps._tag === 'Success' && keeps.success ? [leaf.path] : []));
  if (candidates.length === 0) {
    yield* locked;
    return replaced;
  }
  yield* inTurns(resolved, candidates, locked, 'entry').pipe(
    Effect.catchTag('Tool.Failed', (refusal) =>
      Effect.forEach(input.leaves, (leaf) => input.settle(leaf, failed(leaf.path, 'resolve', refusal)), { discard: true }),
    ),
  );
  return replaced;
});
