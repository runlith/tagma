import { SOURCE_KINDS } from '../contract/wire/sources.js';
import { GRAPH_EVENT_OPS } from '../contract/wire/journal.js';
import { session } from '../../platform/store/writers.js';
import { project } from '../../projects/store/table.js';
import { parseStoredFields, parseStoredTags } from '../contract/wire/fields.js';
import { sql } from 'drizzle-orm';
import { customType, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const jsonText = <T>(fromDriver: (stored: string) => T) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => JSON.stringify(value),
    fromDriver,
  });

const storedTagsColumn = jsonText(parseStoredTags);
const storedFieldsColumn = jsonText(parseStoredFields);

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const block = sqliteTable(
  'block',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    uuid: text('uuid').notNull(),
    path: text('path'),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id),
    parentId: integer('parent_id'),
    ord: real('ord').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    tags: storedTagsColumn('tags').notNull().default([]),
    fields: storedFieldsColumn('fields').notNull().default({}),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('block_parent_idx').on(table.parentId),
    index('block_project_idx').on(table.projectId),
    uniqueIndex('block_uuid_idx').on(table.uuid),
  ],
);

export const blockTag = sqliteTable(
  'block_tag',
  {
    blockId: integer('block_id')
      .notNull()
      .references(() => block.id),
    tag: text('tag').notNull(),
    typeId: text('type_id'),
  },
  (table) => [
    primaryKey({ columns: [table.blockId, table.tag] }),
    index('block_tag_tag_idx').on(table.tag, table.blockId),
    index('block_tag_type_idx').on(table.typeId, table.blockId),
  ],
);

export const blockField = sqliteTable(
  'block_field',
  {
    blockId: integer('block_id')
      .notNull()
      .references(() => block.id),
    tag: text('tag').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blockId, table.tag, table.name, table.value] }),
    index('block_field_seek_idx').on(table.tag, table.name, table.value, table.blockId),
  ],
);

export const edge = sqliteTable(
  'edge',
  {
    fromId: integer('from_id')
      .notNull()
      .references(() => block.id),
    toId: integer('to_id')
      .notNull()
      .references(() => block.id),
    kind: text('kind').notNull(),
    createdBySessionId: integer('created_by_session_id').references(() => session.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromId, table.toId, table.kind] }),
    index('edge_to_idx').on(table.toId, table.kind),
    uniqueIndex('edge_one_successor_idx')
      .on(table.toId)
      .where(sql`${table.kind} = 'supersedes'`),
  ],
);

export const farEdge = sqliteTable(
  'far_edge',
  {
    fromId: integer('from_id')
      .notNull()
      .references(() => block.id),
    kind: text('kind').notNull(),
    graph: text('graph').notNull(),
    uuid: text('uuid').notNull(),
    label: text('label').notNull(),
    createdBySessionId: integer('created_by_session_id').references(() => session.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromId, table.kind, table.graph, table.uuid] }),
    index('far_edge_target_idx').on(table.graph, table.uuid, table.kind),
  ],
);

export const searchIndex = sqliteTable('search_index', {
  blockId: integer('block_id')
    .primaryKey()
    .references(() => block.id),
  titleText: text('title_text').notNull().default(''),
  text: text('text').notNull(),
});

export const ref = sqliteTable(
  'ref',
  {
    fromId: integer('from_id')
      .notNull()
      .references(() => block.id),
    toId: integer('to_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromId, table.toId] }), index('ref_to_idx').on(table.toId)],
);

export const SOURCE_PLACE_INDEX = 'source_place_idx';

export const source = sqliteTable(
  'source',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    blockId: integer('block_id')
      .notNull()
      .references(() => block.id),
    kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
    ref: text('ref').notNull(),
    symbol: text('symbol'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('source_block_idx').on(table.blockId),
    index('source_kind_idx').on(table.kind),
    index(SOURCE_PLACE_INDEX).on(table.ref, table.kind, table.symbol, table.blockId),
    uniqueIndex('source_identity_idx').on(
      table.blockId,
      table.kind,
      table.ref,
      sql`case when ${table.symbol} is null then '' else ${table.symbol} end`,
    ),
  ],
);

export const touch = sqliteTable(
  'touch',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => block.id),
    sessionId: integer('session_id').references(() => session.id),
    place: text('place').notNull(),
    wrote: integer('wrote', { mode: 'boolean' }).notNull().default(false),
    touchedAt: integer('touched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('touch_task_place_idx').on(table.taskId, table.place),
    index('touch_place_idx').on(table.place),
    index('touch_session_idx').on(table.sessionId),
  ],
);

export const event = sqliteTable(
  'event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    sessionId: integer('session_id').references(() => session.id),
    callId: text('call_id'),
    op: text('op', { enum: GRAPH_EVENT_OPS }).notNull(),
    blockId: integer('block_id'),
    projectId: integer('project_id'),
    payload: text('payload').notNull().default('{}'),
  },
  (table) => [
    index('event_session_idx').on(table.sessionId),
    index('event_block_idx').on(table.blockId),
    index('event_project_idx').on(table.projectId, table.id),
    index('event_project_op_idx').on(table.projectId, table.op),
    index('event_project_session_idx').on(table.projectId, table.sessionId),
    index('event_call_idx').on(table.callId),
  ],
);

export const compactUuid = sql`replace(${block.uuid}, '-', '')`;

export const spokenTail = sql`substr(replace(${block.uuid}, '-', ''), -8)`;
