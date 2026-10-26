import { Effect } from 'effect';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { LineTally } from '../lines/tally.js';
import type { WalkUnfinished, Walks } from '../lines/walks.js';
import { followsStanding, retiredWithTexts, workspaceChange, workspaceChangeText, workspaceChangeRetiredText } from '../store/tables.js';
import type { StoreShape } from './places.js';
import { batches, PAGE } from './versions.js';

type Counted = LineTally & { readonly id: string };

const retiring = writes('ChangeRecord.retireTexts', [workspaceChange, workspaceChangeText, workspaceChangeRetiredText]);

const inline = sql<number>`coalesce(octet_length(${workspaceChangeText.oldText}), 0) + coalesce(octet_length(${workspaceChangeText.newText}), 0)`;
const pending = and(eq(workspaceChangeText.row, workspaceChangeRetiredText.row), eq(workspaceChange.id, workspaceChangeText.row));
const ended = sql`${workspaceChange.state} in ('committed', 'withdrawn')`;

const chosen = (counted: readonly Counted[], column: SQLiteColumn, pick: (one: Counted) => number): SQL =>
  sql`case ${workspaceChange.id} ${sql.join(
    counted.map((one) => sql`when ${one.id} then ${pick(one)}`),
    sql` `,
  )} else ${column} end`;

const retire = Effect.fn('ChangeRecord.retireTextsOf')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  walks: Walks,
  ids: readonly string[],
) {
  const rows = yield* units.read(
    (unit) =>
      unit.run(
        store.db
          .select({
            id: workspaceChange.id,
            origin: workspaceChange.origin,
            oldText: workspaceChangeText.oldText,
            newText: workspaceChangeText.newText,
            committedAt: workspaceChange.committedAt,
          })
          .from(workspaceChangeRetiredText)
          .crossJoin(workspaceChangeText)
          .crossJoin(workspaceChange)
          .where(and(pending, inArray(workspaceChangeText.row, [...ids]), ended)),
      ),
    { bulk: true },
  );
  if (rows.length === 0) return 0;
  const committed = rows.filter((row) => row.committedAt !== null);
  const tallies =
    committed.length === 0 ? [] : yield* walks.tallies(committed.map(({ origin, oldText, newText }) => ({ origin, oldText, newText })));
  const counted = committed.flatMap((row, at): Counted[] => {
    const tally = tallies[at];
    return tally === null || tally === undefined ? [] : [{ id: row.id, ...tally }];
  });
  return yield* units.write(retiring, (unit) =>
    Effect.gen(function* () {
      if (counted.length > 0)
        yield* unit.run(
          store.db
            .update(workspaceChange)
            .set({
              added: chosen(counted, workspaceChange.added, (one) => one.added),
              removed: chosen(counted, workspaceChange.removed, (one) => one.removed),
            })
            .where(
              and(
                inArray(
                  workspaceChange.id,
                  counted.map((row) => row.id),
                ),
                retiredWithTexts,
              ),
            ),
        );
      const done = yield* unit.run(
        store.db
          .delete(workspaceChangeText)
          .where(
            and(
              inArray(
                workspaceChangeText.row,
                rows.map((row) => row.id),
              ),
              sql`exists(select 1 from ${workspaceChange} where ${workspaceChange.id} = ${workspaceChangeText.row} and ${workspaceChange.state} in ('committed', 'withdrawn'))`,
            ),
          )
          .returning({ id: workspaceChangeText.row }),
      );
      return done.length;
    }),
  );
});

export const requeueTexts = (units: MachineUnits['Service'], store: StoreShape): Effect.Effect<number, StoreFailure> =>
  units.write(retiring, (unit) =>
    Effect.map(
      unit.run(
        store.db
          .insert(workspaceChangeRetiredText)
          .select((qb) =>
            qb
              .select({ row: workspaceChangeText.row })
              .from(workspaceChangeText)
              .innerJoin(workspaceChange, eq(workspaceChange.id, workspaceChangeText.row))
              .where(sql`${ended} and not ${followsStanding}`),
          )
          .onConflictDoNothing()
          .returning({ row: workspaceChangeRetiredText.row }),
      ),
      (rows) => rows.length,
    ),
  );

export const retireTexts = Effect.fn('ChangeRecord.retireTexts')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  walks: Walks,
): Effect.fn.Return<number, StoreFailure | WalkUnfinished> {
  let retired = 0;
  for (;;) {
    const page = yield* units.read(
      (unit) =>
        unit.run(
          store.db
            .select({
              key: sql<string>`${workspaceChangeRetiredText.row}`,
              bytes: inline,
            })
            .from(workspaceChangeRetiredText)
            .crossJoin(workspaceChangeText)
            .crossJoin(workspaceChange)
            .where(and(pending, ended))
            .limit(PAGE),
        ),
      { bulk: true },
    );
    if (page.length === 0) return retired;
    for (const ids of batches(page)) retired += yield* retire(units, store, walks, ids);
  }
});
