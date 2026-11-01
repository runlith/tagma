import type { ThreadEventPayloadValue, ThreadEventRow } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadProjectionRefusalReason } from '../contract/wire/projection.js';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { type AnySQLiteColumn, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { recordRows, threadRecord } from '../../thread-record/store/table.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { MESSAGE_FTS, messageRows, threadConversation, threadMessageGap, threadQuietRun } from './conversation.js';
import { payloadField } from './fields.js';

const conversationTables = writes('ConversationIndex', [messageRows, threadConversation, threadQuietRun, threadMessageGap, recordRows]);

export const conversationWrites: WriteSet = {
  ...conversationTables,
  reach: new Map([...conversationTables.reach, [MESSAGE_FTS, 'all' as const]]),
};

export const threadRolloutCursor = sqliteTable('thread_rollout_cursor', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  nextByteOffset: integer('next_byte_offset').notNull().default(0),
  nextPosition: integer('next_position').notNull().default(1),
  generation: integer('generation').notNull().default(0),
  restedAt: integer('rested_at', { mode: 'timestamp_ms' }),
});

export const threadJournalPlace = sqliteTable('thread_journal_place', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull(),
});

export const journalProjectOf = (thread: SQLWrapper, home: SQLWrapper): SQL<number | null> =>
  sql<
    number | null
  >`coalesce((select ${threadJournalPlace.projectId} from ${threadJournalPlace} where ${threadJournalPlace.threadId} = ${thread}), ${home})`;

export const threadRolloutHome = sqliteTable('thread_rollout_home', {
  path: text('path').primaryKey(),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
});

export const threadRolloutForm = sqliteTable('thread_rollout_form', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  formedAt: integer('formed_at', { mode: 'timestamp_ms' }).notNull(),
  refusal: text('refusal'),
  publishing: text('publishing', { mode: 'json' }).$type<RolloutPublishing>(),
  step: text('step'),
});

export type RolloutPublishing = { readonly sha256: string; readonly cursorBytes: number | null; readonly refusalBytes: number | null };

export const threadRolloutRefusal = sqliteTable('thread_rollout_refusal', {
  threadId: text('thread_id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  reason: text('reason').$type<ThreadProjectionRefusalReason>().notNull(),
  message: text('message').notNull(),
  nextByteOffset: integer('next_byte_offset').notNull(),
  nextPosition: integer('next_position').notNull(),
  seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
});

export const threadEventIdentity = (payload: AnySQLiteColumn | SQL): SQL => sql`case
    when ${payloadField(payload, 'entry.toolCallId')} is not null
      then 'tool:' || coalesce(${payloadField(payload, 'entry.runId')}, '') || ':' ||
           ${payloadField(payload, 'entry.toolCallId')}
    else ${payloadField(payload, 'entry.id')}
  end`;

export const threadEvent = sqliteTable(
  'thread_event',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    id: text('id').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<ThreadEventPayloadValue>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.position] }),
    uniqueIndex('thread_event_id_unique').on(table.id),
    index('thread_event_entry_idx')
      .on(table.threadId, threadEventIdentity(table.payload), table.position)
      .where(sql`${payloadField(table.payload, 'entry.id')} is not null`),
  ],
);

export const threadBase = sqliteTable(
  'thread_base',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
    sourceId: text('source_id').notNull(),
    lowOrd: integer('low_ord').notNull(),
    highOrd: integer('high_ord').notNull(),
    afterPosition: integer('after_position').notNull(),
    throughPosition: integer('through_position').notNull(),
    prompts: text('prompts').$type<'kept' | 'dropped'>().notNull(),
    hidden: text('hidden', { mode: 'json' }).$type<readonly string[]>().notNull(),
    unfiled: integer('unfiled', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.depth] }), index('thread_base_source_idx').on(table.sourceId)],
);

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ThreadEventRowMatches = Assert<Exact<typeof threadEvent.$inferSelect, ThreadEventRow>>;
