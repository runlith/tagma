import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Clock, Effect } from 'effect';
import { WAKING_THREAD_EVENTS, type WakingThreadEvent } from '@runlith/agent/contracts';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { among } from '../../platform/store/rows.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ThreadSubscriptions, type ThreadSubscription } from '../contract/service/subscriptions.js';

export const threadSubscription = sqliteTable(
  'thread_subscription',
  {
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    wakes: text('wakes', { mode: 'json' }).$type<readonly WakingThreadEvent[]>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.subscriberId, table.targetId] }), index('thread_subscription_target_idx').on(table.targetId)],
);

const subscribing = writes('ThreadSubscriptions.write', [threadSubscription]);

type Row = typeof threadSubscription.$inferSelect;

const subscriptionOf = (row: Row): ThreadSubscription => ({
  subscriberId: row.subscriberId,
  targetId: row.targetId,
  wakes: row.wakes ?? WAKING_THREAD_EVENTS,
  createdAt: row.createdAt,
});

export const endSubscriptions = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, threadIds: readonly string[]) => {
  if (threadIds.length === 0) return Effect.void;
  const ids = among([...threadIds]);
  return Effect.asVoid(
    unit.run(
      db.delete(threadSubscription).where(or(inArray(threadSubscription.subscriberId, ids), inArray(threadSubscription.targetId, ids))),
    ),
  );
};

export const makeThreadSubscriptions = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const rowsOf = (subscriberId: string) =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select()
            .from(threadSubscription)
            .where(eq(threadSubscription.subscriberId, subscriberId))
            .orderBy(asc(threadSubscription.createdAt), asc(threadSubscription.targetId)),
        ),
        (rows) => rows.map(subscriptionOf),
      ),
    );

  return ThreadSubscriptions.of({
    subscribe: Effect.fn('ThreadSubscriptions.subscribe')(function* (subscriberId, targets, wakes) {
      const named = [...new Set(targets)].filter((target) => target !== subscriberId);
      if (named.length > 0) {
        const createdAt = new Date(yield* Clock.currentTimeMillis);
        const stored = wakes === undefined ? null : WAKING_THREAD_EVENTS.filter((kind) => wakes.includes(kind));
        yield* units.write(subscribing, (unit) =>
          unit.run(
            db
              .insert(threadSubscription)
              .values(named.map((targetId) => ({ subscriberId, targetId, wakes: stored, createdAt })))
              .onConflictDoUpdate({ target: [threadSubscription.subscriberId, threadSubscription.targetId], set: { wakes: stored } }),
          ),
        );
      }
      const held = new Set(named);
      return (yield* rowsOf(subscriberId)).filter((row) => held.has(row.targetId));
    }),
    unsubscribe: (subscriberId, targets) =>
      targets.length === 0
        ? Effect.succeed([])
        : units.write(subscribing, (unit) =>
            Effect.map(
              unit.run(
                db
                  .delete(threadSubscription)
                  .where(and(eq(threadSubscription.subscriberId, subscriberId), inArray(threadSubscription.targetId, among([...targets]))))
                  .returning({ targetId: threadSubscription.targetId }),
              ),
              (rows) => rows.map((row) => row.targetId),
            ),
          ),
    of: rowsOf,
    subscribersOf: (targetId) =>
      units.read((unit) =>
        Effect.map(unit.run(db.select().from(threadSubscription).where(eq(threadSubscription.targetId, targetId))), (rows) =>
          rows.map(subscriptionOf),
        ),
      ),
  });
});
