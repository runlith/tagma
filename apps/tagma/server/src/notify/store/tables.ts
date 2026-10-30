import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { type NotificationLink, OUTCOME_KINDS } from '../contract/wire/notification.js';

export const notification = sqliteTable(
  'notification',
  {
    id: text('id').primaryKey(),
    sender: text('sender').notNull(),
    key: text('key'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    questionText: text('question_text'),
    questionOptions: text('question_options', { mode: 'json' }).$type<string[]>(),
    link: text('link', { mode: 'json' }).$type<NotificationLink>(),
    createdAt: integer('created_at').notNull(),
    endedAt: integer('ended_at'),
    outcome: text('outcome', { enum: OUTCOME_KINDS }),
    answer: text('answer'),
    deliveredAt: integer('delivered_at'),
  },
  (table) => [
    index('notification_sender_idx').on(table.sender),
    index('notification_ended_idx').on(table.endedAt),
    uniqueIndex('notification_key_idx').on(table.sender, table.key),
  ],
);
