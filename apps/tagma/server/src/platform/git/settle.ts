import { randomUUID } from 'node:crypto';
import { copyFile, open, rename, rm, stat } from 'node:fs/promises';
import { Data, Duration, Effect } from 'effect';
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
const PROBE_BYTES = 1024 * 1024;
const INDEX_IO_MARGIN = 4;
const deviceRates = new Map<number, Promise<number>>();

const probeRate = async (index: string): Promise<number> => {
  const path = `${index}.tagma-probe-${randomUUID()}`;
  const handle = await open(path, 'wx', 0o600);
  try {
    const started = performance.now();
    await handle.writeFile(Buffer.alloc(PROBE_BYTES));
    await handle.sync();
    return PROBE_BYTES / Math.max(1, performance.now() - started) / INDEX_IO_MARGIN;
  } finally {
    try {
      await handle.close();
    } finally {
      await rm(path, { force: true });
    }
  }
};

const indexMeasure = async (index: string): Promise<{ readonly bytes: number; readonly bytesPerMs: number }> => {
  const snapshot = await stat(index).catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? null : Promise.reject(cause)));
  if (snapshot === null || snapshot.size === 0) return { bytes: 0, bytesPerMs: 1 };
  let rate = deviceRates.get(snapshot.dev);
  if (rate === undefined) {
    rate = probeRate(index).catch((cause: unknown) => {
      deviceRates.delete(snapshot.dev);
      throw cause;
    });
    deviceRates.set(snapshot.dev, rate);
  }
  return { bytes: snapshot.size, bytesPerMs: await rate };
};

const indexSection = declare<{ readonly path: string; readonly bytesPerMs: number }>({
  name: 'git-index',
  owner: 'platform',
  rank: 300,
  key: ({ path }) => path,
  concurrency: 1,
  threshold: '500 millis',
  ceilings: {
    hold: {
      base: '5 seconds',
      bySize: (bytes, keys) => Duration.millis(bytes / keys[0]!.bytesPerMs),
    },
    wait: '1 second',
    leaves: "the paths stay unsettled and git's own index.lock is removed",
  },
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

export const settleIndex = Effect.fn('platform.index.settle')(function* (
  git: Git['Service'],
  checkout: string,
  places: GitPlaces,
  ref: string,
  entries: readonly SettleEntry[],
): Effect.fn.Return<Settlement, IndexBusy | IndexWriteFailed | OwnGitFailed | HoldStalled | HoldCut> {
  if (entries.length === 0) return { paths: new Map(), moved: false };
  const { index, gitDir } = places;
  const guard = yield* shaOf(git, checkout, ref);
  const paths = entries.map((entry) => entry.path);
  const atRef = yield* treeBlobs(git, checkout, guard, paths);
  const superseded = (entry: SettleEntry) => (atRef.get(entry.path)?.blob ?? null) !== entry.landed;
  const measured = yield* Effect.tryPromise({ try: () => indexMeasure(index), catch: failed(index) });
  return yield* indexWrites.hold(
    index,
    indexSection.hold(
      { path: gitDir, bytesPerMs: measured.bytesPerMs },
      measured.bytes,
      Effect.suspend(() => {
        const temp = `${index}.tagma-${randomUUID()}`;
        let renamed = false;
        return Effect.acquireUseRelease(
          takeLock(index),
          (lock) =>
            Effect.gen(function* () {
              const onRef = (yield* refOfHead(git, checkout)) === ref;
              if ((yield* shaOf(git, checkout, ref)) !== guard) {
                return {
                  paths: new Map<string, Settled>(
                    entries.map((entry) => [entry.path, superseded(entry) ? 'superseded' : 'unsynced'] as const),
                  ),
                  moved: true,
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
              if (lines.length > 0) {
                yield* Effect.uninterruptible(
                  Effect.tryPromise({
                    try: () =>
                      copyFile(index, temp).catch((cause: NodeJS.ErrnoException) =>
                        cause.code === 'ENOENT' ? null : Promise.reject(cause),
                      ),
                    catch: failed(index),
                  }),
                );
                yield* runGitBytes(git, 'settle-write', ['-C', checkout, 'update-index', '-z', '--index-info'], {
                  env: { GIT_INDEX_FILE: temp },
                  stdin: lines.map((line) => `${line}\0`).join(''),
                });
                yield* Effect.uninterruptible(
                  Effect.tryPromise({
                    try: async () => {
                      const written = await open(temp, 'r+');
                      try {
                        await written.sync();
                      } finally {
                        await written.close();
                      }
                      await lock.close();
                      await rename(temp, `${index}.lock`);
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
              const after = yield* quietGit(git, 'settle-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]);
              const moved = after !== guard;
              if (moved) for (const [path, outcome] of decided) if (outcome === 'synced') decided.set(path, 'unsynced');
              return { paths: decided, moved };
            }),
          (lock) =>
            Effect.tryPromise({
              try: async () => {
                await lock.close();
                if (!renamed) await rm(`${index}.lock`, { force: true });
                await rm(temp, { force: true });
                await rm(`${temp}.lock`, { force: true });
              },
              catch: failed(index),
            }),
        );
      }),
    ),
  );
});
