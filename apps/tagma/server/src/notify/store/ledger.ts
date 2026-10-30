import { MachineStore } from '../../platform/contract/service/store.js';
import { and, count, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { Notification, Outcome } from '../contract/wire/notification.js';
import { notification } from './tables.js';

export type Row = typeof notification.$inferSelect;

export const notificationOf = (row: Row): Notification => ({
  id: row.id,
  sender: row.sender,
  title: row.title,
  body: row.body,
  at: new Date(row.createdAt).toISOString(),
  question: row.questionText === null ? null : { text: row.questionText, options: row.questionOptions ?? [] },
  link: row.link,
});

export const outcomeOf = (row: Row): Outcome | null =>
  row.outcome === null || row.endedAt === null ? null : { kind: row.outcome, answer: row.answer, at: new Date(row.endedAt).toISOString() };

export type Ending = { readonly kind: Outcome['kind']; readonly answer: string | null; readonly at: number };

export const makeLedger = Effect.gen(function* () {
  const db = (yield* MachineStore).db;
  const units = yield* MachineUnits;

  return {
    byId: (id: string) => units.read((unit) => unit.run(db.select().from(notification).where(eq(notification.id, id)).get())),
    open: units.read((unit) =>
      unit.run(db.select().from(notification).where(isNull(notification.endedAt)).orderBy(desc(notification.createdAt)).all()),
    ),
    unhanded: units.read((unit) =>
      unit.run(
        db
          .select()
          .from(notification)
          .where(and(isNotNull(notification.endedAt), isNull(notification.deliveredAt)))
          .all(),
      ),
    ),
    insert: Effect.fn('Ledger.insert')((row: Row, openLimit: number) =>
      units.write(writes('Ledger.insert', [notification]), (unit) =>
        Effect.gen(function* () {
          if (row.key !== null) {
            const prior = yield* unit.run(
              db
                .select()
                .from(notification)
                .where(and(eq(notification.sender, row.sender), eq(notification.key, row.key)))
                .get(),
            );
            if (prior !== undefined) return { _tag: 'existing', row: prior } as const;
          }
          const held = yield* unit.run(
            db
              .select({ open: count() })
              .from(notification)
              .where(and(eq(notification.sender, row.sender), isNull(notification.endedAt)))
              .get(),
          );
          if ((held?.open ?? 0) >= openLimit) return { _tag: 'full' } as const;
          yield* unit.run(db.insert(notification).values(row));
          return { _tag: 'stored' } as const;
        }),
      ),
    ),
    end: (id: string, ending: Ending) =>
      units.write(writes('Ledger.end', [notification]), (unit) =>
        unit.run(
          db
            .update(notification)
            .set({ endedAt: ending.at, outcome: ending.kind, answer: ending.answer })
            .where(and(eq(notification.id, id), isNull(notification.endedAt)))
            .returning()
            .get(),
        ),
      ),
    keys: (sender: string) =>
      units.read((unit) =>
        unit.run(
          db
            .select({ key: notification.key })
            .from(notification)
            .where(and(eq(notification.sender, sender), isNotNull(notification.key)))
            .all(),
        ),
      ),
    withdraw: (sender: string, key: string | null) =>
      units.write(writes('Ledger.withdraw', [notification]), (unit) =>
        unit.run(
          db
            .delete(notification)
            .where(key === null ? eq(notification.sender, sender) : and(eq(notification.sender, sender), eq(notification.key, key)))
            .returning()
            .all(),
        ),
      ),
    handed: (id: string, at: number) =>
      units.write(writes('Ledger.handed', [notification]), (unit) =>
        unit.run(db.update(notification).set({ deliveredAt: at }).where(eq(notification.id, id))),
      ),
    sweep: (before: number) =>
      units.write(writes('Ledger.sweep', [notification]), (unit) =>
        unit.run(db.delete(notification).where(and(isNotNull(notification.endedAt), lt(notification.endedAt, before)))),
      ),
  };
});

export class Ledger extends Context.Service<Ledger, Effect.Success<typeof makeLedger>>()('notify/Ledger') {}
export const ledgerLayer = Layer.effect(Ledger, makeLedger);
