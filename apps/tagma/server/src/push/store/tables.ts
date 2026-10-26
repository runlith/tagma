import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const pushSubscription = sqliteTable('push_subscription', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const pushSent = sqliteTable(
  'push_sent',
  {
    subscriptionId: text('subscription_id').notNull(),
    subject: text('subject').notNull(),
    eventId: text('event_id').notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.subscriptionId, table.subject, table.eventId] }), index('push_sent_at_idx').on(table.sentAt)],
);
