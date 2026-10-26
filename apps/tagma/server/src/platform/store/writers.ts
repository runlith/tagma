import { readOnly } from '@runlith/sqlite-process/SqliteProcess';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { Clock, Effect, Layer } from 'effect';
import { GraphStore, MachineStore, type StoreBrand, type StoreDb } from '../contract/service/store.js';
import { writes } from '../contract/service/writes.js';
import { MachineWriters, SignedSession, WriterRegister } from '../contract/service/writers.js';
import type { WriteUnit } from '../contract/service/units.js';
import type { SessionRef } from '../contract/wire/session.js';

export const session = sqliteTable(
  'session',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    harness: text('harness').notNull(),
    key: text('key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('session_identity_idx').on(table.harness, table.key)],
);

const resolveWriter = Effect.fn('WriterRegister.resolve')(function* <Brand extends StoreBrand>(
  db: StoreDb<Brand>,
  unit: WriteUnit<Brand>,
  ref: SessionRef,
) {
  const found = yield* unit.run(
    db
      .select()
      .from(session)
      .where(and(eq(session.harness, ref.harness), eq(session.key, ref.key)))
      .get(),
  );
  if (found) return found;
  const row = yield* unit.run(
    db
      .insert(session)
      .values({ harness: ref.harness, key: ref.key, createdAt: new Date(yield* Clock.currentTimeMillis) })
      .returning()
      .get(),
  );
  if (!row) return yield* Effect.die('session insert returned no row');
  return row;
});

export const machineWritersLayer: Layer.Layer<MachineWriters, never, MachineStore> = Layer.effect(
  MachineWriters,
  Effect.gen(function* () {
    const store = yield* MachineStore;
    return MachineWriters.of({
      signedId: Effect.fnUntraced(function* () {
        const signed = yield* SignedSession;
        if (signed === null) return null;
        return (yield* store.transaction(writes('MachineWriters.signedId', [session]), (unit) => resolveWriter(store.db, unit, signed))).id;
      }),
    });
  }),
);

export const writerRegisterLayer: Layer.Layer<WriterRegister, never, GraphStore> = Layer.effect(
  WriterRegister,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const resolve = (unit: WriteUnit<'graph'>, ref: SessionRef) => resolveWriter(db, unit, ref);

    return WriterRegister.of({
      resolve,

      signedId: Effect.fnUntraced(function* (unit) {
        const signed = yield* SignedSession;
        return signed === null ? null : (yield* resolve(unit, signed)).id;
      }),

      idOf: (ref) =>
        readOnly(
          Effect.map(
            db
              .select({ id: session.id })
              .from(session)
              .where(and(eq(session.harness, ref.harness), eq(session.key, ref.key)))
              .get(),
            (row) => row?.id ?? null,
          ),
        ),

      writerOf: (sessionId) =>
        sessionId === null
          ? Effect.succeed(null)
          : readOnly(
              Effect.map(db.select().from(session).where(eq(session.id, sessionId)).get(), (row) =>
                row === undefined ? null : { id: row.id, harness: row.harness, key: row.key },
              ),
            ),

      byId: (id) => readOnly(db.select().from(session).where(eq(session.id, id)).get()),

      all: () => readOnly(db.select().from(session).orderBy(desc(session.id))),

      named: (ids) => {
        const wanted = [...new Set(ids)];
        return wanted.length === 0 ? Effect.succeed([]) : readOnly(db.select().from(session).where(inArray(session.id, wanted)));
      },
    });
  }),
);
