import { eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { StoreDb, StoreFailure } from '../platform/contract/service/store.js';
import type { Unit } from '../platform/contract/service/units.js';
import { type ExternalSession, parseExternalSession } from '../threads/contract/wire/harness/externalSession.js';
import { externalSession, leased, sessionRows, sessionValues } from '../threads/store/harnessFacet.js';

export const readSession = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string): Effect.Effect<unknown, StoreFailure> =>
  Effect.map(
    unit.run(
      db
        .select({ facet: externalSession.facet, leaseOwner: externalSession.leaseOwner, leaseBeat: externalSession.leaseBeat })
        .from(externalSession)
        .where(eq(externalSession.id, id))
        .get(),
    ),
    (row) => (row === undefined ? null : leased(row.facet, row)),
  );

export const readExternalSession = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  id: string,
): Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal> =>
  readSession(db, unit, id).pipe(
    Effect.flatMap((facet) =>
      Effect.try({
        try: () => parseExternalSession(facet),
        catch: (cause) => new GateRefusal('session-unreadable', String(cause), ['inspect the stored external session']),
      }),
    ),
  );

export const readSessions = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  ids: readonly string[],
): Effect.Effect<ReadonlyMap<string, unknown>, StoreFailure> =>
  ids.length === 0
    ? Effect.succeed(new Map())
    : Effect.map(
        unit.run(
          db
            .select()
            .from(sessionRows)
            .where(inArray(sessionRows.id, [...ids])),
        ),
        (rows) => new Map(rows.map((row) => [row.id, leased(row.facet, row)])),
      );

export const writeSession = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  id: string,
  facet: ExternalSession,
): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(
    unit.run(
      db
        .update(externalSession)
        .set({ ...sessionValues(facet), updatedAt: new Date() })
        .where(eq(externalSession.id, id)),
    ),
  );
