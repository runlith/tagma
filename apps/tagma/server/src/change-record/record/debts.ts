import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { chunk } from '@runlith/utils/collection';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { DebtReference } from '../lines/owed.js';
import type { DebtRecord } from '../lines/evidence.js';
import { changeDebt } from '../store/retirement.js';
import { PLACES_PER_STATEMENT, type StoreShape } from './places.js';

const within = (checkout: string, paths: readonly string[]) =>
  and(eq(changeDebt.checkout, checkout), eq(changeDebt.source, 'steps'), inArray(changeDebt.path, paths));

export const debtRowsAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly DebtRecord[]>, StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const found = new Map<string, DebtRecord[]>();
      for (const group of chunk([...new Set(paths)], PLACES_PER_STATEMENT)) {
        const rows = yield* unit.run(
          store.db
            .select({
              path: changeDebt.path,
              commit: changeDebt.commit,
              windows: sql<string>`${changeDebt.windows}`,
              windowCount: sql<number>`json_array_length(${changeDebt.windows})`,
            })
            .from(changeDebt)
            .where(within(checkout, group)),
        );
        for (const row of rows) {
          const values = found.get(row.path) ?? [];
          values.push({ commit: row.commit, windows: row.windows, windowCount: row.windowCount });
          found.set(row.path, values);
        }
      }
      return found;
    }),
  );

export const debtsAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly DebtReference[]>, StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const found = new Map<string, DebtReference[]>();
      for (const group of chunk([...new Set(paths)], PLACES_PER_STATEMENT)) {
        const rows = yield* unit.run(
          store.db.select({ path: changeDebt.path, commit: changeDebt.commit }).from(changeDebt).where(within(checkout, group)),
        );
        for (const row of rows) {
          const values = found.get(row.path) ?? [];
          values.push({ commit: row.commit });
          found.set(row.path, values);
        }
      }
      return found;
    }),
  );
