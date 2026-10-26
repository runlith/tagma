import { Effect } from 'effect';
import { eq, inArray } from 'drizzle-orm';
import { chunk } from '@runlith/utils/collection';
import type { LineHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { workspaceChange, workspaceChangeText } from '../store/tables.js';
import type { StoreShape } from './places.js';

export type HunkRow = {
  readonly id: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly firstLine: number | null;
  readonly newLines: number | null;
  readonly oldLines: number | null;
  readonly windowBefore: number | null;
};

export const putHunkText = (
  db: StoreShape['db'],
  row: string,
  oldText: string | null,
  newText: string | null,
): Effect.Effect<void, StoreFailure> =>
  oldText === null && newText === null
    ? Effect.asVoid(db.delete(workspaceChangeText).where(eq(workspaceChangeText.row, row)))
    : Effect.asVoid(
        db
          .insert(workspaceChangeText)
          .values({ row, oldText, newText })
          .onConflictDoUpdate({ target: workspaceChangeText.row, set: { oldText, newText } }),
      );

const EMPTY = contentDigest('');

export const hunksOf = Effect.fn('WorkspaceChangeLog.hunks')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  rows: readonly HunkRow[],
  versions: ReadonlyMap<string, string> = new Map(),
): Effect.fn.Return<ReadonlyMap<string, LineHunk>, StoreFailure> {
  const asked = new Map(
    rows
      .filter((row) => row.firstLine !== null && row.newLines !== null && row.oldLines !== null && row.windowBefore !== null)
      .map((row) => [row.id, row]),
  );
  const hunks = new Map<string, LineHunk>();
  for (const row of asked.values()) {
    const text = row.afterHash === null ? undefined : versions.get(row.afterHash);
    if (
      row.beforeHash !== EMPTY ||
      row.firstLine !== 1 ||
      row.windowBefore !== 0 ||
      row.oldLines !== 0 ||
      row.newLines === null ||
      text === undefined
    )
      continue;
    hunks.set(row.id, { firstLine: 1, windowBefore: 0, oldLines: 0, newLines: row.newLines, oldText: '', newText: text });
    asked.delete(row.id);
  }
  for (const ids of chunk([...asked.keys()], rowsPerStatement(1))) {
    const found = yield* units.read(
      (unit) =>
        unit.run(
          store.db
            .select({
              id: workspaceChange.id,
              beforeHash: workspaceChange.beforeHash,
              afterHash: workspaceChange.afterHash,
              oldText: workspaceChangeText.oldText,
              newText: workspaceChangeText.newText,
            })
            .from(workspaceChange)
            .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange.id))
            .where(inArray(workspaceChange.id, ids)),
        ),
      { bulk: true },
    );
    for (const one of found) {
      const row = asked.get(one.id)!;
      if (
        row.beforeHash !== one.beforeHash ||
        row.afterHash !== one.afterHash ||
        one.oldText === null ||
        row.firstLine === null ||
        row.newLines === null ||
        row.oldLines === null ||
        row.windowBefore === null
      )
        continue;
      hunks.set(row.id, {
        firstLine: row.firstLine,
        newLines: row.newLines,
        oldLines: row.oldLines,
        windowBefore: row.windowBefore,
        oldText: one.oldText,
        newText: one.newText ?? '',
      });
    }
  }
  return hunks;
});
