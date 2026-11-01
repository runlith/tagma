import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { chunk } from '@runlith/utils/collection';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { LandedRecord } from '../lines/evidence.js';
import { changeLanded } from '../store/retirement.js';
import { PLACES_PER_STATEMENT, type StoreShape } from './places.js';

export const landedAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly LandedRecord[]>, StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const found = new Map<string, LandedRecord[]>();
      for (const group of chunk([...new Set(paths)], PLACES_PER_STATEMENT)) {
        const rows = yield* unit.run(
          store.db
            .select({
              path: changeLanded.path,
              digest: changeLanded.digest,
              head: changeLanded.head,
              working: changeLanded.working,
              pieces: sql<string>`${changeLanded.pieces}`,
            })
            .from(changeLanded)
            .where(and(eq(changeLanded.checkout, checkout), inArray(changeLanded.path, group)))
            .orderBy(asc(changeLanded.path), asc(changeLanded.digest)),
        );
        for (const { path, ...landed } of rows) {
          const standing = found.get(path);
          if (standing === undefined) found.set(path, [landed]);
          else standing.push(landed);
        }
      }
      return found;
    }),
  );
