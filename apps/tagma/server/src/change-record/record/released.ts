import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { chunk } from '@runlith/utils/collection';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { StoreShape } from './places.js';
import { PLACES_PER_STATEMENT } from './places.js';
import type { ReleasedRecord } from '../lines/evidence.js';
import { releasedLine } from '../store/retirement.js';

export const releasedAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly ReleasedRecord[]>, StoreFailure> =>
  units.read((unit) =>
    Effect.gen(function* () {
      const result = new Map<string, ReleasedRecord[]>();
      for (const group of chunk([...new Set(paths)], PLACES_PER_STATEMENT)) {
        const rows = yield* unit.run(
          store.db
            .select({
              path: releasedLine.path,
              row: releasedLine.row,
              thread: releasedLine.thread,
              reason: releasedLine.reason,
              span: sql<string>`${releasedLine.span}`,
            })
            .from(releasedLine)
            .where(and(eq(releasedLine.checkout, checkout), inArray(releasedLine.path, group)))
            .orderBy(releasedLine.row),
        );
        for (const row of rows) {
          const standing = result.get(row.path);
          if (standing === undefined) result.set(row.path, [row]);
          else standing.push(row);
        }
      }
      return result;
    }),
  );
