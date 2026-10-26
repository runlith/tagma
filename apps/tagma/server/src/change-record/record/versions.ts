import { Effect } from 'effect';
import { and, asc, gt, inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { chunk, unique } from '@runlith/utils/collection';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { standing, workspaceChange, workspaceChangeContent, workspaceChangeReleased } from '../store/tables.js';
import { commandContent } from '../store/commandTables.js';
import type { StoreShape } from './places.js';

export type Sized = { readonly key: string; readonly bytes: number | null };

export const PAGE = 512;

const UNIT_BYTES = 1024 * 1024;

const DIGESTS_PER_STATEMENT = rowsPerStatement(1);

const collecting = writes('ChangeRecord.collectVersions', [workspaceChangeContent, workspaceChangeReleased]);

const heldBy = (column: SQLiteColumn) =>
  sql`exists (select 1 from ${workspaceChange} where ${column} = ${workspaceChangeContent.digest} and ${standing})`;

const unheld = sql<number>`(not ${heldBy(workspaceChange.beforeHash)} and not ${heldBy(workspaceChange.afterHash)} and not exists(select 1 from ${commandContent} where ${commandContent.digest} = ${workspaceChangeContent.digest}))`;

const size = sql<number | null>`octet_length(${workspaceChangeContent.text})`;

export const releaseVersions = (
  db: MachineStore['Service']['db'],
  digests: readonly (string | null)[],
): Effect.Effect<void, StoreFailure> =>
  Effect.forEach(
    chunk(unique(digests.filter((digest): digest is string => digest !== null)), DIGESTS_PER_STATEMENT),
    (part) =>
      db
        .insert(workspaceChangeReleased)
        .select((qb) =>
          qb
            .select({ digest: workspaceChangeContent.digest })
            .from(workspaceChangeContent)
            .where(inArray(workspaceChangeContent.digest, part)),
        )
        .onConflictDoNothing(),
    { discard: true },
  );

export const batches = (sized: readonly Sized[]): readonly (readonly string[])[] => {
  const cut: (readonly string[])[] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const one of sized) {
    const weight = one.bytes ?? 0;
    if (current.length > 0 && bytes + weight > UNIT_BYTES) {
      cut.push(current);
      current = [];
      bytes = 0;
    }
    current.push(one.key);
    bytes += weight;
  }
  if (current.length > 0) cut.push(current);
  return cut;
};

const collect = (
  units: MachineUnits['Service'],
  store: StoreShape,
  digests: readonly string[],
  released: boolean,
): Effect.Effect<number, StoreFailure> =>
  units.write(collecting, (unit) =>
    Effect.gen(function* () {
      const gone = yield* unit.run(
        store.db
          .delete(workspaceChangeContent)
          .where(and(inArray(workspaceChangeContent.digest, [...digests]), unheld))
          .returning({ digest: workspaceChangeContent.digest }),
      );
      if (released) yield* unit.run(store.db.delete(workspaceChangeReleased).where(inArray(workspaceChangeReleased.digest, [...digests])));
      return gone.length;
    }),
  );

export const collectReleased = Effect.fn('ChangeRecord.collectReleased')(function* (units: MachineUnits['Service'], store: StoreShape) {
  let collected = 0;
  for (;;) {
    const page = yield* units.read((unit) =>
      unit.run(
        store.db
          .select({
            key: workspaceChangeReleased.digest,
            bytes: sql<
              number | null
            >`(select ${size} from ${workspaceChangeContent} where ${workspaceChangeContent.digest} = ${workspaceChangeReleased.digest})`,
          })
          .from(workspaceChangeReleased)
          .orderBy(asc(workspaceChangeReleased.digest))
          .limit(PAGE),
      ),
    );
    if (page.length === 0) return collected;
    for (const digests of batches(page)) collected += yield* collect(units, store, digests, true);
  }
});

export const sweepVersions = Effect.fn('ChangeRecord.sweepVersions')(function* (units: MachineUnits['Service'], store: StoreShape) {
  let collected = 0;
  let after = '';
  for (;;) {
    const page = yield* units.read(
      (unit) =>
        unit.run(
          store.db
            .select({ key: workspaceChangeContent.digest, bytes: size, loose: unheld })
            .from(workspaceChangeContent)
            .where(gt(workspaceChangeContent.digest, after))
            .orderBy(asc(workspaceChangeContent.digest))
            .limit(PAGE),
        ),
      { bulk: true },
    );
    const last = page[page.length - 1];
    if (last === undefined) return collected;
    after = last.key;
    for (const digests of batches(page.filter((one) => one.loose === 1))) collected += yield* collect(units, store, digests, false);
  }
});
