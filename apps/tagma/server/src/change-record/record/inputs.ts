import { Effect } from 'effect';
import { and, sql } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import { treeEntriesAt } from '@runlith/git/entries';
import { chunk } from '@runlith/utils/collection';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import { held, workspaceChange, workspaceChangeContent } from '../store/tables.js';
import { PLACES_PER_STATEMENT, type StoreShape, placeKey, samePlaces } from './places.js';

export type HeldRows = {
  readonly key: string;
  readonly rows: readonly { readonly id: string; readonly threadId: string; readonly evidence: string }[];
};

export const headObjectsAt = (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, string | null>> =>
  Effect.map(
    treeEntriesAt(git, dir, 'HEAD', paths),
    (read) => new Map(paths.map((path) => [path, read.unread.has(path) ? null : (read.entries.get(path)?.object ?? 'absent')] as const)),
  );

export const heldRowsAt = Effect.fn('WorkspaceChangeLog.heldRowsAt')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  places: readonly PlacedPath[],
): Effect.fn.Return<ReadonlyMap<string, HeldRows>, StoreFailure> {
  const found = new Map<string, { readonly id: string; readonly threadId: string; readonly evidence: string }[]>();
  const kept = (digest: typeof workspaceChange.beforeHash) =>
    sql<number>`exists(select 1 from ${workspaceChangeContent} where ${workspaceChangeContent.digest} = ${digest})`;
  for (const group of chunk(places, PLACES_PER_STATEMENT)) {
    const rows = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({
            id: workspaceChange.id,
            threadId: workspaceChange.holder,
            path: workspaceChange.path,
            checkout: workspaceChange.checkout,
            beforeKept: kept(workspaceChange.beforeHash),
            afterKept: kept(workspaceChange.afterHash),
          })
          .from(workspaceChange)
          .where(and(samePlaces(workspaceChange, group), held)),
      ),
    );
    const asked = new Set(group.map(placeKey));
    for (const row of rows) {
      if (!asked.has(placeKey(row))) continue;
      const standing = found.get(row.path) ?? [];
      const evidence = `${row.id}:${row.beforeKept ? 1 : 0}${row.afterKept ? 1 : 0}`;
      standing.push({ id: row.id, threadId: row.threadId, evidence });
      found.set(row.path, standing);
    }
  }
  return new Map(
    [...found].map(
      ([path, rows]) =>
        [
          path,
          {
            key: rows
              .map((row) => row.evidence)
              .sort()
              .join(','),
            rows,
          },
        ] as const,
    ),
  );
});
