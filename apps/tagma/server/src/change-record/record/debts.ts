import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { chunk } from '@runlith/utils/collection';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Debt } from '../lines/owed.js';
import { changeDebt } from '../store/retirement.js';
import { PLACES_PER_STATEMENT, type StoreShape } from './places.js';

export const debtsAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly Debt[]>, StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const found = new Map<string, Debt[]>();
      for (const group of chunk([...new Set(paths)], PLACES_PER_STATEMENT)) {
        const rows = yield* unit.run(
          store.db
            .select({ path: changeDebt.path, commit: changeDebt.commit, windows: changeDebt.windows })
            .from(changeDebt)
            .where(and(eq(changeDebt.checkout, checkout), eq(changeDebt.source, 'steps'), inArray(changeDebt.path, group))),
        );
        for (const row of rows) found.set(row.path, [...(found.get(row.path) ?? []), { commit: row.commit, windows: row.windows }]);
      }
      return found;
    }),
  );
