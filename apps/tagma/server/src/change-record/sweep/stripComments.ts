import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import { filesUnder } from '@runlith/git/entries';
import type { Git } from '@runlith/git/Git';
import { languageOf } from '@runlith/source-comments/languages';
import type { sweepProse, SweptFile } from '@runlith/agent-tools/sweepProse';
import { held, workspaceChange } from '../store/tables.js';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { generatedAmong } from '../../platform/git/generated.js';

import type { CommentSweep, StripCommentsFailure } from '../contract/service/sweep.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

export type SessionName = { readonly name: string | null; readonly ended: boolean };

export type StripCommentsContext = {
  readonly git: Git['Service'];
  readonly machine: StoreShape;
  readonly sessionNames: (threadIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, SessionName>, StoreFailure>;
  readonly threadId: string;
  readonly root: string;
  readonly graphDirectory: string;
  readonly checkout: string | null;
  readonly sweepProse: (paths: readonly string[]) => ReturnType<typeof sweepProse>;
};

export const stripComments = Effect.fn('stripComments')(function* (
  ctx: StripCommentsContext,
  path: string,
): Effect.fn.Return<CommentSweep, StripCommentsFailure> {
  const root = resolve(ctx.root);
  const place = relative(root, resolve(root, path));
  if (place.startsWith('..') || isAbsolute(place)) {
    return yield* new GateRefusal('path-outside-tree', `path escapes the checkout this sweep answers for: ${path}`, [
      'name a file or directory inside the checkout',
    ]);
  }
  const candidates = yield* sweptPaths(ctx.git, root, place, ctx.graphDirectory);
  if (candidates === null) {
    return yield* new GateRefusal(
      'repository-unread',
      `git could not list what stands under ${place === '' ? '.' : place}, so which files this may write is unknown and none was read`,
      ['run it inside a readable checkout of this project'],
    );
  }
  const holders = yield* holdersOfPaths(ctx, candidates);
  const mine = candidates.filter((candidate) => !holders.has(candidate));
  const swept = yield* ctx.sweepProse(mine.map((candidate) => resolve(root, candidate)));
  const named = (file: SweptFile): string => relative(root, file.path);
  return {
    path: place === '' ? '.' : place,
    read: mine.length,
    dropped: swept.reduce((total, file) => (file.swept === 'stripped' || file.swept === 'unrecorded' ? total + file.dropped : total), 0),
    stripped: swept.flatMap((file) => (file.swept === 'stripped' ? [{ path: named(file), dropped: file.dropped }] : [])),
    unrecorded: swept.flatMap((file) => (file.swept === 'unrecorded' ? [{ path: named(file), dropped: file.dropped }] : [])),
    unlexable: swept.flatMap((file) => (file.swept === 'unlexable' ? [{ path: named(file), reason: file.reason }] : [])),
    exempt: swept.flatMap((file) => (file.swept === 'exempt' ? [named(file)] : [])),
    linesHeld: [...holders.entries()].map(([path, who]) => ({ path, holders: who })),
  };
});

const sweptPaths = Effect.fn('stripComments.paths')(function* (
  git: Git['Service'],
  root: string,
  place: string,
  graphDirectory: string,
): Effect.fn.Return<readonly string[] | null> {
  const listed = yield* Effect.result(filesUnder(git, root, place, { others: true }));
  if (listed._tag !== 'Success') {
    yield* Effect.logWarning('the comment sweep reads no paths: git could not list the files under the place', {
      root,
      place,
      reason: listed.failure.message,
    });
    return null;
  }
  const kept = new Set<string>();
  for (const entry of listed.success) {
    if (languageOf(entry) === null) continue;
    const segments = entry.split('/');
    if (segments[0] === graphDirectory || segments.includes('node_modules')) continue;
    kept.add(entry);
  }
  const generated = yield* Effect.result(generatedAmong(git, root, [...kept], null));
  if (generated._tag !== 'Success') {
    yield* Effect.logWarning('the comment sweep reads no paths: git could not tell which files under the place are generated', {
      root,
      place,
      reason: generated.failure.message,
    });
    return null;
  }
  return [...kept].filter((path) => !generated.success.has(path)).sort();
});

const holdersOfPaths = Effect.fn('stripComments.holders')(function* (
  ctx: StripCommentsContext,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, readonly string[]>, GateRefusal<'record-unread'>> {
  if (paths.length === 0) return new Map<string, readonly string[]>();
  const rows = yield* ctx.machine.db
    .selectDistinct({ path: workspaceChange.path, threadId: workspaceChange.holder })
    .from(workspaceChange)
    .where(
      and(
        eq(workspaceChange.checkout, ctx.checkout ?? ''),
        inArray(workspaceChange.path, [...paths]),
        held,
        ne(workspaceChange.holder, ctx.threadId),
      ),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new GateRefusal(
            'record-unread',
            `the record of who holds these paths could not be read, so nothing is written over them: ${cause.message}`,
            ['read it again once the store answers'],
          ),
      ),
    );
  if (rows.length === 0) return new Map<string, readonly string[]>();
  const names = yield* ctx
    .sessionNames([...new Set(rows.map((row) => row.threadId))])
    .pipe(
      Effect.mapError(
        (cause) =>
          new GateRefusal('record-unread', `the sessions holding these paths could not be named: ${cause.message}`, [
            'read it again once the store answers',
          ]),
      ),
    );
  const byPath = new Map<string, string[]>();
  for (const row of rows) {
    const holder = names.get(row.threadId);
    const label = holder?.name ?? row.threadId;
    byPath.set(row.path, [...(byPath.get(row.path) ?? []), holder?.ended === true ? `${label} (that session is over)` : label]);
  }
  return byPath;
});

export function bytesAt(root: string, path: string): string | null {
  const at = join(root, path);
  try {
    if (!readdirSync(dirname(at)).includes(basename(at))) return null;
    return readFileSync(at, 'utf8');
  } catch {
    return null;
  }
}
