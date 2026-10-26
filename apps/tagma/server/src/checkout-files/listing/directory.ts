import { availableParallelism } from 'node:os';
import { readdir, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import type { WorkerUnavailable } from '@runlith/utils/worker';
import { page, readCursor, type PageKey } from '@runlith/paging';
import { Git } from '@runlith/git/Git';
import { ignoredAmong } from '@runlith/git/entries';
import { GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { CheckoutWatch } from '../../workspace/contract/service/watch.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../workspace/contract/wire/roots.js';
import { Directories, type DirectoryAsk, type DirectoryRefusal } from '../contract/service/directories.js';
import { DIRECTORY, type DirectoryEntry, type LinkTarget, type TreeFrame } from '../contract/wire/directory.js';
import type { FilesWorker } from '../worker/client.js';
import { compareRanked, type Ranked } from './order.js';
import { framesOf } from './tree.js';

const HIDDEN: ReadonlySet<string> = new Set(['.git', '.DS_Store']);

export const ORDERED_INLINE = 4096;

export const PAGED_KEPT = 16;

type Listed = { readonly name: string; readonly kind: DirectoryEntry['kind']; readonly target?: LinkTarget };

type Paged = { readonly stamp: string; readonly rows: readonly Listed[] };

const isDirectory = (row: Listed): boolean => row.kind === 'directory' || row.target === 'directory';

const rankOf = (row: Listed): Ranked => ({ name: row.name, dir: isDirectory(row) });

const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

const OPENED: TreeFrame = { kind: 'rescan', reason: 'opened' };

const GONE: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

const refuse = <Code extends DirectoryRefusal>(code: Code, reason: string, unblock: string): GateRefusal<Code> =>
  new GateRefusal(code, reason, [unblock]);

const positionOf = (row: Listed, at: PageKey): number => compareRanked(rankOf(row), { name: String(at[1]), dir: at[0] === 0 });

export const makeDirectoryListing = Effect.fnUntraced(function* (input: { readonly worker: FilesWorker; readonly graphDirectory: string }) {
  const git = yield* Git;
  const paths = yield* CheckoutPaths;
  const watch = yield* CheckoutWatch;
  const { worker, graphDirectory } = input;
  const paged = new Map<string, Paged>();
  const linksAtOnce = Math.max(4, availableParallelism() * 2);

  const keep = (key: string, held: Paged): void => {
    paged.delete(key);
    paged.set(key, held);
    if (paged.size > PAGED_KEPT) paged.delete(paged.keys().next().value as string);
  };

  const resume = (
    cursor: string | undefined,
    question: Parameters<typeof readCursor>[1],
  ): Effect.Effect<PageKey | undefined, GateRefusal<'bad-cursor' | 'cursor-stale'>> => {
    if (cursor === undefined) return Effect.succeed(undefined);
    const read = readCursor(cursor, question);
    return 'refused' in read ? Effect.fail(cursorRefusal(read.refused)) : Effect.succeed(read.at);
  };

  const stampOf = (absolute: string, shown: string): Effect.Effect<string, GateRefusal<DirectoryRefusal>> =>
    Effect.tryPromise({ try: () => stat(absolute, { bigint: true }), catch: (cause) => cause }).pipe(
      Effect.map((info) => `${info.ino}:${info.mtimeNs}:${info.ctimeNs}`),
      Effect.mapError((cause) => {
        const code = codeOf(cause);
        if (code === 'ENOENT') return refuse('not-found', `${shown || 'the root'} does not exist`, 'list a directory that exists');
        if (code === 'ENOTDIR') return refuse('not-a-directory', `${shown} is not a directory`, 'list a directory');
        return refuse('files', `cannot list ${shown || 'the root'}: ${failure(cause)}`, 'read the report and retry');
      }),
    );

  const classified = (absolute: string, rootReal: string, one: Dirent): Effect.Effect<Listed> => {
    if (one.isDirectory()) return Effect.succeed({ name: one.name, kind: 'directory' });
    if (!one.isSymbolicLink()) return Effect.succeed({ name: one.name, kind: 'file' });
    return Effect.promise(async (): Promise<Listed> => {
      const place = join(absolute, one.name);
      try {
        const [real, info] = await Promise.all([realpath(place), stat(place)]);
        const within = real === rootReal || real.startsWith(`${rootReal}/`);
        return { name: one.name, kind: 'link', target: !within ? 'outside' : info.isDirectory() ? 'directory' : 'file' };
      } catch (cause) {
        return { name: one.name, kind: 'link', target: GONE.has(codeOf(cause) ?? '') ? 'broken' : 'unreadable' };
      }
    });
  };

  const read = Effect.fnUntraced(function* (absolute: string, rootReal: string, shown: string) {
    const dirents = yield* Effect.tryPromise({ try: () => readdir(absolute, { withFileTypes: true }), catch: (cause) => cause }).pipe(
      Effect.mapError((cause) => {
        const code = codeOf(cause);
        if (code === 'ENOENT') return refuse('not-found', `${shown || 'the root'} does not exist`, 'list a directory that exists');
        if (code === 'ENOTDIR') return refuse('not-a-directory', `${shown} is not a directory`, 'list a directory');
        return refuse('files', `cannot list ${shown || 'the root'}: ${failure(cause)}`, 'read the report and retry');
      }),
    );
    const top = shown === '';
    const kept = dirents.filter((one) => !HIDDEN.has(one.name) && !(top && one.name === graphDirectory));
    return yield* Effect.forEach(kept, (one) => classified(absolute, rootReal, one), { concurrency: linksAtOnce });
  });

  const ordered = (rows: readonly Listed[]): Effect.Effect<readonly Listed[], GateRefusal<'worker-unavailable'>> => {
    if (rows.length <= ORDERED_INLINE) {
      return Effect.succeed([...rows].sort((left, right) => compareRanked(rankOf(left), rankOf(right))));
    }
    return worker.ask({ kind: 'order', names: rows.map((row) => row.name), dirs: rows.map(isDirectory) }).pipe(
      Effect.map((reply) => (reply.kind === 'ordered' ? reply.order.map((index) => rows[index] as Listed) : rows)),
      Effect.mapError((gone: WorkerUnavailable) => refuse('worker-unavailable', gone.message, 'ask again; the worker starts afresh')),
    );
  };

  const ignored = (
    root: string,
    segments: readonly string[],
    shown: readonly Listed[],
    ask: DirectoryAsk,
  ): Effect.Effect<(name: string) => boolean, GateRefusal<DirectoryRefusal>> => {
    if (ask.ignored) return Effect.succeed(() => true);
    if (shown.length === 0) return Effect.succeed(() => false);
    const prefix = segments.length === 0 ? '' : `${segments.join('/')}/`;
    return ignoredAmong(
      git,
      root,
      shown.map((row) => `${prefix}${row.name}`),
    ).pipe(
      Effect.map((set) => (name: string) => set.has(`${prefix}${name}`)),
      Effect.mapError(gitRefusal),
    );
  };

  return Directories.of({
    tree: (rootId: RootId): Stream.Stream<TreeFrame, RootResolutionFailure> =>
      Stream.unwrap(
        Effect.map(
          Effect.acquireRelease(watch.follow(rootId), (following) => Effect.sync(() => following.release())),
          (following) =>
            Stream.concat(
              Stream.make(OPENED),
              following.shifts.pipe(
                Stream.map((shift) => framesOf(shift, graphDirectory)),
                Stream.filter((frame): frame is TreeFrame => frame !== null),
              ),
            ),
        ),
      ),

    list: Effect.fnUntraced(function* (place, ask) {
      const segments = ask.path.split('/').filter((part) => part !== '' && part !== '.');
      const shown = segments.join('/');
      yield* Effect.mapError(paths.pathWithin(place.path, shown), (refused) =>
        refuse(refused.code === 'files' ? 'files' : 'path-outside-tree', refused.reason, 'ask for a directory inside the checkout'),
      );
      if (segments[0] === graphDirectory) {
        return yield* refuse('graph-path', `${shown} is the graph's own tree`, 'the graph is read through the graph operations');
      }
      const rootReal = yield* Effect.tryPromise({ try: () => realpath(place.path), catch: (cause) => cause }).pipe(
        Effect.mapError((cause) => refuse('files', `cannot resolve the checkout root: ${failure(cause)}`, 'read the report and retry')),
      );
      const absolute = join(place.path, ...segments);
      const question = { operation: 'read_directory', selection: { rootId: place.rootId, path: shown }, order: DIRECTORY.order };
      const at = yield* resume(ask.cursor, question);
      const key = `${place.rootId}\0${shown}`;
      const stamp = yield* stampOf(absolute, shown);
      const kept = at === undefined ? undefined : paged.get(key);
      const sorted =
        kept !== undefined && kept.stamp === stamp ? kept.rows : yield* Effect.flatMap(read(absolute, rootReal, shown), ordered);
      if (sorted.length > ask.rows) keep(key, { stamp, rows: sorted });
      else paged.delete(key);
      const after = at === undefined ? sorted : sorted.filter((row) => positionOf(row, at) > 0);
      const window = after.slice(0, ask.rows + 1);
      const flags = yield* ignored(place.path, segments, window.slice(0, ask.rows), ask);
      const entries = window.map((row): DirectoryEntry => ({ ...row, ignored: flags(row.name) }));
      const answered = page({
        rows: entries,
        asked: ask.rows,
        keyOf: (row): PageKey => [isDirectory(row) ? 0 : 1, row.name],
        question,
        total: sorted.length,
      });
      return { ...answered, total: sorted.length };
    }),
  });
});
