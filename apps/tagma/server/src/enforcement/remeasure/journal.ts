import { and, asc, eq, gt, or } from 'drizzle-orm';
import { Effect, Option, Schema } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Units } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { JournaledLanding, LandingEntry, LandingJournal } from '../contract/service/remeasure.js';
import { CarriedViolation } from '../contract/wire/enforcement.js';
import { remeasureLanding } from '../store/tables.js';

const putting = writes('enforcement.journalLanding', [remeasureLanding]);
const removing = writes('enforcement.settleLanding', [remeasureLanding]);
const parking = writes('enforcement.parkLanding', [remeasureLanding]);

const said = Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed('')));

const Carried = Schema.Struct({ ...CarriedViolation.fields, title: said, message: said, generalFix: said });

const Journaled = Schema.Struct({
  kind: Schema.Literal('tree'),
  projectId: Schema.Int,
  root: Schema.String,
  commit: Schema.String,
  paths: Schema.Array(Schema.String),
  base: Schema.optional(Schema.String),
  caller: Schema.optional(TerminalActor),
  carried: Schema.optional(Schema.Array(Carried)),
  told: Schema.optional(Schema.Literal(true)),
  op: Schema.String,
});

const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Journaled));

export const landingEntry = Effect.fn('enforcement.landingEntry')(function* (landing: JournaledLanding) {
  const payload = JSON.stringify(landing);
  const digest = yield* Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  return {
    landing,
    payload,
    key: `${landing.projectId}\0${landing.root}\0${landing.commit}\0${Buffer.from(digest).toString('hex')}`,
  } satisfies LandingEntry;
});

export const landingJournal = (db: StoreDb<'machine'>, units: Units<'machine'>): LandingJournal => ({
  put: ({ key, landing, payload }) =>
    units.write(putting, (unit) =>
      Effect.asVoid(
        unit.run(
          db
            .insert(remeasureLanding)
            .values({ key, projectId: landing.projectId, root: landing.root, payload, at: new Date() })
            .onConflictDoNothing(),
        ),
      ),
    ),
  remove: (key) =>
    units.write(removing, (unit) => Effect.asVoid(unit.run(db.delete(remeasureLanding).where(eq(remeasureLanding.key, key))))),
  park: (key, reason) =>
    units.write(parking, (unit) =>
      Effect.asVoid(unit.run(db.update(remeasureLanding).set({ parked: reason }).where(eq(remeasureLanding.key, key)))),
    ),
  page: (after, limit) =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select()
            .from(remeasureLanding)
            .where(
              after === null
                ? undefined
                : or(gt(remeasureLanding.at, after.at), and(eq(remeasureLanding.at, after.at), gt(remeasureLanding.key, after.key))),
            )
            .orderBy(asc(remeasureLanding.at), asc(remeasureLanding.key))
            .limit(limit)
            .all(),
        ),
        (rows) => rows.map((row) => ({ key: row.key, at: row.at, landing: Option.getOrNull(decoded(row.payload)), parked: row.parked })),
      ),
    ),
});
