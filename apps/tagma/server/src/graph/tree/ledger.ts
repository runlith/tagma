import { lstatSync, type Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Clock, Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { connectionsOf } from './connections.js';
import { rowText } from './export.js';
import type { TreeChange } from './freshness.js';
import { BlockTreeUnreadable, type TreeRoots, fileIn } from './layout.js';

type Standing = {
  readonly change: TreeChange;
  readonly text: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly at: number;
};

type Expected =
  | { readonly kind: 'file'; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number; readonly ino: number }
  | { readonly kind: 'dir' }
  | { readonly kind: 'absent' };

const ECHO_KEPT_MS = 30_000;

const gone = (cause: unknown): boolean =>
  (cause as NodeJS.ErrnoException).code === 'ENOENT' || (cause as NodeJS.ErrnoException).code === 'ENOTDIR';

const unlessGone = <A>(abs: string, read: () => Promise<A>) =>
  Effect.tryPromise({
    try: () => read().catch((cause) => (gone(cause) ? null : Promise.reject(cause))),
    catch: (cause) => new BlockTreeUnreadable({ reason: 'io', path: abs, message: String(cause) }),
  });

const expectedOf = (abs: string): Expected => {
  let found: Stats;
  try {
    found = lstatSync(abs);
  } catch (cause) {
    if (gone(cause)) return { kind: 'absent' };
    throw cause;
  }
  if (found.isDirectory()) return { kind: 'dir' };
  return { kind: 'file', size: found.size, mtimeMs: found.mtimeMs, ctimeMs: found.ctimeMs, ino: found.ino };
};

const sameExpected = (one: Expected, other: Expected): boolean =>
  one.kind === 'file' && other.kind === 'file'
    ? one.size === other.size && one.mtimeMs === other.mtimeMs && one.ctimeMs === other.ctimeMs && one.ino === other.ino
    : one.kind === other.kind;

export const treeLedger = Effect.fnUntraced(function* (roots: TreeRoots, projectId: number) {
  const fileOf = (path: string): string => fileIn(roots, path);
  const clock = yield* Clock.Clock;
  const own = new Map<string, { readonly expected: Expected; readonly at: number }>();
  const reflected = new Map<string, { size: number; mtimeMs: number; at: number }>();
  let asked = new Set<string>();

  return {
    wrote: (relative: string) => {
      const now = clock.currentTimeMillisUnsafe();
      for (const [path, held] of own) if (now - held.at > ECHO_KEPT_MS) own.delete(path);
      own.set(relative, { expected: expectedOf(fileOf(relative)), at: now });
    },
    echoes: (paths: readonly string[]) => {
      if (paths.length === 0) return false;
      return paths.every((path) => {
        const held = own.get(path);
        return held !== undefined && sameExpected(held.expected, expectedOf(fileOf(path)));
      });
    },
    unreflected: Effect.fn('TreeLedger.unreflected')(function* (changes: readonly TreeChange[]) {
      const named = new Set(changes.map((change) => change.path));
      const returned = [...asked].filter((path) => !named.has(path)).map((path) => ({ status: 'M', path }));
      asked = named;
      const all = [...changes, ...returned];
      const news: TreeChange[] = [];
      if (all.length === 0) return news;
      const standing: Standing[] = [];
      for (const change of all) {
        const abs = fileOf(change.path);
        const measured = yield* unlessGone(abs, () => stat(abs));
        if (measured === null) {
          reflected.delete(change.path);
          if (named.has(change.path)) news.push(change);
          continue;
        }
        const { size, mtimeMs } = measured;
        const seen = reflected.get(change.path);
        if (seen !== undefined && seen.size === size && seen.mtimeMs === mtimeMs && mtimeMs < seen.at) continue;
        const text = yield* unlessGone(abs, () => readFile(abs, 'utf8'));
        if (text === null) {
          reflected.delete(change.path);
          news.push(change);
          continue;
        }
        standing.push({ change, text, size, mtimeMs, at: yield* clock.currentTimeMillis });
      }
      if (standing.length === 0) return news;
      const { db } = yield* GraphStore;
      const rows = yield* db
        .select()
        .from(block)
        .where(
          and(
            eq(block.projectId, projectId),
            inArray(
              block.path,
              standing.map((item) => item.change.path),
            ),
          ),
        );
      const held = new Map(rows.map((row) => [row.path as string, row]));
      const connections = yield* connectionsOf(projectId, rows);
      for (const item of standing) {
        const row = held.get(item.change.path);
        if (row === undefined || row.uuid === null) {
          reflected.delete(item.change.path);
          news.push(item.change);
          continue;
        }
        if (rowText({ ...row, uuid: row.uuid }, connections) === item.text) {
          reflected.set(item.change.path, { size: item.size, mtimeMs: item.mtimeMs, at: item.at });
          continue;
        }
        reflected.delete(item.change.path);
        news.push(item.change);
      }
      return news;
    }),
  };
});

export type TreeLedger = Effect.Success<ReturnType<typeof treeLedger>>;
