import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { copyFile, open, rename, rm } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { declare } from '@runlith/held/Held';
import { type OwnGitFailed, quietGit, runGit, runGitBytes } from './ownGit.js';
import { indexWrites } from './index.js';
import type { GitPlaces } from './places.js';

export type SettleEntry = {
  readonly path: string;
  readonly base: string | null;
  readonly landed: string | null;
};

export type Settled = 'synced' | 'superseded' | 'unsynced';

export type Settlement = {
  readonly paths: ReadonlyMap<string, Settled>;
  readonly moved: boolean;
};

export class IndexBusy extends Data.TaggedError('IndexBusy')<{ readonly index: string }> {
  override get message(): string {
    return `${this.index}.lock is held by another git process, so the index was left as it stood`;
  }
}

export class IndexWriteFailed extends Data.TaggedError('IndexWriteFailed')<{ readonly index: string; readonly reason: string }> {}

const LOCK_TRIES = 3;
const LOCK_PAUSE_MS = 100;
const WINDOWS_COMMAND_LINE = 32_767;
const PATHSPEC_BYTES = Math.floor(WINDOWS_COMMAND_LINE / 2);

const indexSection = declare<string>({
  name: 'git-index',
  owner: 'platform',
  rank: 300,
  key: (path) => path,
  concurrency: 1,
  threshold: '500 millis',
  ceilings: 'none',
  external: { named: "git under git's own index.lock", callsBack: false },
});

const failed = (index: string) => (cause: unknown) =>
  new IndexWriteFailed({ index, reason: cause instanceof Error ? cause.message : String(cause) });

const refOfHead = (git: Git['Service'], checkout: string): Effect.Effect<string, OwnGitFailed> =>
  Effect.map(quietGit(git, 'settle-head', ['-C', checkout, 'symbolic-ref', '-q', 'HEAD']), (ref) => ref || 'HEAD');

const shaOf = (git: Git['Service'], checkout: string, ref: string): Effect.Effect<string, OwnGitFailed> =>
  runGit(git, 'settle-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]);

const records = (out: string): string[] => out.split('\0').filter((record) => record !== '');

const batches = (paths: readonly string[]): readonly (readonly string[])[] => {
  const out: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 3;
    if (batch.length > 0 && bytes + size > PATHSPEC_BYTES) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(path);
    bytes += size;
  }
  if (batch.length > 0) out.push(batch);
  return out;
};

const treeBlobs = (git: Git['Service'], checkout: string, sha: string, paths: readonly string[]) =>
  Effect.map(
    Effect.forEach(batches(paths), (batch) =>
      runGitBytes(git, 'settle-tree', ['-C', checkout, '--literal-pathspecs', 'ls-tree', '-z', '--full-tree', sha, '--', ...batch]),
    ),
    (outs) => {
      const blobs = new Map<string, { readonly mode: string; readonly blob: string }>();
      for (const out of outs) {
        for (const record of records(out)) {
          const tab = record.indexOf('\t');
          const [mode = '', , blob = ''] = record.slice(0, tab).split(' ');
          blobs.set(record.slice(tab + 1), { mode, blob });
        }
      }
      return blobs;
    },
  );

const STAGES = ['0', '1', '2', '3'] as const;
const OBJECT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const BREAKS = /[\r\n]/;

const listed = (out: string, blobs: Map<string, string | 'conflicted'>): void => {
  for (const record of records(out)) {
    const tab = record.indexOf('\t');
    const [, blob = '', stage = '0'] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    blobs.set(path, stage === '0' && !blobs.has(path) ? blob : 'conflicted');
  }
};

const indexBlobs = Effect.fnUntraced(function* (git: Git['Service'], checkout: string, paths: readonly string[]) {
  const blobs = new Map<string, string | 'conflicted'>();
  const lined = paths.filter((path) => !BREAKS.test(path));
  if (lined.length > 0) {
    const out = yield* runGitBytes(git, 'settle-index', ['-C', checkout, 'cat-file', '--batch-check=%(objectname)'], {
      stdin: lined.flatMap((path) => STAGES.map((stage) => `:${stage}:${path}\n`)).join(''),
    });
    const answers = out.split('\n');
    for (const [at, path] of lined.entries()) {
      const [merged = '', ...sides] = STAGES.map((_, stage) => answers[at * STAGES.length + stage] ?? '');
      if (sides.some((side) => OBJECT.test(side))) blobs.set(path, 'conflicted');
      else if (OBJECT.test(merged)) blobs.set(path, merged);
    }
  }
  for (const batch of batches(paths.filter((path) => BREAKS.test(path)))) {
    listed(
      yield* runGitBytes(git, 'settle-index-lines', [
        '-C',
        checkout,
        '--literal-pathspecs',
        'ls-files',
        '-s',
        '-z',
        '--full-name',
        '--',
        ...batch,
      ]),
      blobs,
    );
  }
  return blobs;
});

const takeLock = Effect.fn('platform.index.lock')(function* (index: string) {
  for (let attempt = 1; ; attempt += 1) {
    const handle = yield* Effect.tryPromise({
      try: () =>
        open(`${index}.lock`, 'wx').catch((cause: NodeJS.ErrnoException) => (cause.code === 'EEXIST' ? null : Promise.reject(cause))),
      catch: failed(index),
    });
    if (handle !== null) return handle;
    if (attempt >= LOCK_TRIES) return yield* new IndexBusy({ index });
    yield* Effect.sleep(LOCK_PAUSE_MS);
  }
});

export type IndexEdit<A, E, R> = {
  readonly value: A;
  readonly write: ((temporary: string) => Effect.Effect<void, E, R>) | null;
};

export const editHeldIndex = Effect.fn('platform.index.edit')(function* <A, E, R, W, S>(
  index: string,
  edit: Effect.Effect<IndexEdit<A, W, S>, E, R>,
): Effect.fn.Return<A, E | W | IndexBusy | IndexWriteFailed, R | S> {
  return yield* indexSection.hold(
    dirname(index),
    Effect.suspend(() => {
      const temporary = `${index}.tagma-${randomUUID()}`;
      let renamed = false;
      return Effect.acquireUseRelease(
        takeLock(index),
        (lock) =>
          Effect.gen(function* () {
            const edited = yield* edit;
            if (edited.write !== null) {
              yield* Effect.uninterruptible(
                Effect.tryPromise({
                  try: () =>
                    copyFile(index, temporary).catch((cause: NodeJS.ErrnoException) =>
                      cause.code === 'ENOENT' ? null : Promise.reject(cause),
                    ),
                  catch: failed(index),
                }),
              );
              yield* edited.write(temporary);
              yield* Effect.uninterruptible(
                Effect.tryPromise({
                  try: async () => {
                    const written = await open(temporary, 'r+');
                    try {
                      await written.sync();
                    } finally {
                      await written.close();
                    }
                    await lock.close();
                    await rename(temporary, `${index}.lock`);
                    await rename(`${index}.lock`, index);
                  },
                  catch: failed(index),
                }).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      renamed = true;
                    }),
                  ),
                ),
              );
            }
            return edited.value;
          }),
        (lock) =>
          Effect.tryPromise({
            try: async () => {
              await lock.close();
              if (!renamed) await rm(`${index}.lock`, { force: true });
              await rm(temporary, { force: true });
              await rm(`${temporary}.lock`, { force: true });
            },
            catch: failed(index),
          }),
      );
    }),
  );
});

type SettleFailure = IndexBusy | IndexWriteFailed | OwnGitFailed | HoldStalled | HoldCut;

export const settleIndex = (
  git: Git['Service'],
  checkout: string,
  places: GitPlaces,
  ref: string,
  entries: readonly SettleEntry[],
): Effect.Effect<Settlement, SettleFailure> =>
  entries.length === 0
    ? Effect.succeed({ paths: new Map(), moved: false })
    : indexWrites.hold(places.index, settleHeldIndex(git, checkout, places, ref, entries));

export const settleHeldIndex = Effect.fn('platform.index.settle')(function* (
  git: Git['Service'],
  checkout: string,
  places: GitPlaces,
  ref: string,
  entries: readonly SettleEntry[],
): Effect.fn.Return<Settlement, SettleFailure> {
  if (entries.length === 0) return { paths: new Map(), moved: false };
  const { index } = places;
  const guard = yield* shaOf(git, checkout, ref);
  const paths = entries.map((entry) => entry.path);
  const atRef = yield* treeBlobs(git, checkout, guard, paths);
  const superseded = (entry: SettleEntry) => (atRef.get(entry.path)?.blob ?? null) !== entry.landed;
  const settled = yield* editHeldIndex(
    index,
    Effect.gen(function* () {
      const onRef = (yield* refOfHead(git, checkout)) === ref;
      if ((yield* shaOf(git, checkout, ref)) !== guard) {
        return {
          value: {
            paths: new Map<string, Settled>(entries.map((entry) => [entry.path, superseded(entry) ? 'superseded' : 'unsynced'] as const)),
            moved: true,
          },
          write: null,
        };
      }
      const staged = yield* indexBlobs(git, checkout, paths);
      const decided = new Map<string, Settled>();
      const lines: string[] = [];
      for (const entry of entries) {
        const now = atRef.get(entry.path);
        if (superseded(entry)) {
          decided.set(entry.path, 'superseded');
          continue;
        }
        const inIndex = staged.get(entry.path) ?? null;
        if (!onRef || (inIndex !== entry.base && inIndex !== entry.landed)) {
          decided.set(entry.path, 'unsynced');
          continue;
        }
        decided.set(entry.path, 'synced');
        if (inIndex === entry.landed) continue;
        lines.push(now === undefined ? `0 ${'0'.repeat(guard.length)}\t${entry.path}` : `${now.mode} ${now.blob}\t${entry.path}`);
      }
      return {
        value: { paths: decided, moved: false },
        write:
          lines.length === 0
            ? null
            : (temporary: string) =>
                Effect.asVoid(
                  runGitBytes(git, 'settle-write', ['-C', checkout, 'update-index', '-z', '--index-info'], {
                    env: { GIT_INDEX_FILE: temporary },
                    stdin: lines.map((line) => `${line}\0`).join(''),
                  }),
                ),
      };
    }),
  );
  const after = yield* quietGit(git, 'settle-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  const moved = settled.moved || after !== guard;
  const decided = new Map(settled.paths);
  if (moved) for (const [path, outcome] of decided) if (outcome === 'synced') decided.set(path, 'unsynced');
  return { paths: decided, moved };
});
