import { MachineStore } from '../../platform/contract/service/store.js';
import { and, eq, lt, or } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { pushSent, pushSubscription } from './tables.js';

export type SubscriptionRow = typeof pushSubscription.$inferSelect;

export type Delivery = { readonly subscriptionId: string; readonly subject: string; readonly eventId: string };

export const makeLedger = Effect.gen(function* () {
  const db = (yield* MachineStore).db;
  const units = yield* MachineUnits;

  return {
    all: units.read((unit) => unit.run(db.select().from(pushSubscription).all())),
    byId: (id: string) => units.read((unit) => unit.run(db.select().from(pushSubscription).where(eq(pushSubscription.id, id)).get())),
    put: Effect.fn('Ledger.put')((row: SubscriptionRow) =>
      units.write(writes('Ledger.put', [pushSubscription, pushSent]), (unit) =>
        Effect.gen(function* () {
          const replaced = yield* unit.run(
            db
              .delete(pushSubscription)
              .where(or(eq(pushSubscription.deviceId, row.deviceId), eq(pushSubscription.endpoint, row.endpoint)))
              .returning({ id: pushSubscription.id })
              .all(),
          );
          for (const { id } of replaced) yield* unit.run(db.delete(pushSent).where(eq(pushSent.subscriptionId, id)));
          yield* unit.run(db.insert(pushSubscription).values(row));
        }),
      ),
    ),
    remove: Effect.fn('Ledger.remove')((where: { readonly id: string } | { readonly deviceId: string }) => {
      const match = 'id' in where ? eq(pushSubscription.id, where.id) : eq(pushSubscription.deviceId, where.deviceId);
      return units.write(writes('Ledger.remove', [pushSubscription, pushSent]), (unit) =>
        Effect.gen(function* () {
          const removed = yield* unit.run(db.delete(pushSubscription).where(match).returning({ id: pushSubscription.id }).all());
          for (const { id } of removed) yield* unit.run(db.delete(pushSent).where(eq(pushSent.subscriptionId, id)));
        }),
      );
    }),
    sent: (delivery: Delivery) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ at: pushSent.sentAt })
              .from(pushSent)
              .where(
                and(
                  eq(pushSent.subscriptionId, delivery.subscriptionId),
                  eq(pushSent.subject, delivery.subject),
                  eq(pushSent.eventId, delivery.eventId),
                ),
              )
              .get(),
          ),
          (row) => row !== undefined,
        ),
      ),
    mark: (delivery: Delivery, at: Date) =>
      units.write(writes('Ledger.mark', [pushSent]), (unit) =>
        unit.run(
          db
            .insert(pushSent)
            .values({ ...delivery, sentAt: at })
            .onConflictDoNothing(),
        ),
      ),
    sweep: (before: Date) =>
      units.write(writes('Ledger.sweep', [pushSent]), (unit) => unit.run(db.delete(pushSent).where(lt(pushSent.sentAt, before)))),
  };
});

export class Ledger extends Context.Service<Ledger, Effect.Success<typeof makeLedger>>()('push/Ledger') {}
export const ledgerLayer = Layer.effect(Ledger, makeLedger);
