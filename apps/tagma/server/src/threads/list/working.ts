import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { heldSessions } from './select.js';

export const workingThreads = (db: StoreDb<'machine'>, units: MachineUnits['Service']): Effect.Effect<number, StoreFailure> =>
  units.read((unit) =>
    Effect.map(
      unit.run(
        db
          .select({ held: sql<number>`count(distinct thread_id)` })
          .from(heldSessions)
          .get(),
      ),
      (row) => row?.held ?? 0,
    ),
  );
