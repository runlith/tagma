import { PERFORMANCE_RECORD_KINDS } from './protocol/records.js';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const performanceRecord = sqliteTable(
  'performance_record',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: PERFORMANCE_RECORD_KINDS }).notNull(),
    instanceId: text('instance_id').notNull(),
    wallTime: integer('wall_time').notNull(),
    monotonicStart: real('monotonic_start').notNull(),
    monotonicEnd: real('monotonic_end').notNull(),
    traceId: text('trace_id'),
    parentId: text('parent_id'),
    name: text('name'),
    runId: text('run_id'),
    payload: text('payload').notNull(),
  },
  (table) => [
    index('performance_record_time_idx').on(table.wallTime, table.id),
    index('performance_record_trace_idx').on(table.traceId, table.monotonicStart),
    index('performance_record_kind_name_time_idx').on(table.kind, table.name, table.wallTime),
    index('performance_record_overlap_idx').on(table.instanceId, table.monotonicStart, table.monotonicEnd),
  ],
);

export const SEGMENT_DDL: ReadonlyArray<string> = [
  `create table if not exists performance_record (
    id text primary key not null,
    kind text not null,
    instance_id text not null,
    wall_time integer not null,
    monotonic_start real not null,
    monotonic_end real not null,
    trace_id text,
    parent_id text,
    name text,
    run_id text,
    payload text not null
  )`,
  `create index if not exists performance_record_time_idx on performance_record (wall_time, id)`,
  `create index if not exists performance_record_trace_idx on performance_record (trace_id, monotonic_start)`,
  `create index if not exists performance_record_kind_name_time_idx on performance_record (kind, name, wall_time)`,
  `create index if not exists performance_record_overlap_idx on performance_record (instance_id, monotonic_start, monotonic_end)`,
];

export const SEGMENT_STATES = ['open', 'sealed', 'deleted'] as const;
export type SegmentState = (typeof SEGMENT_STATES)[number];

export const performanceSegment = sqliteTable('performance_segment', {
  startedAt: integer('started_at').primaryKey(),
  state: text('state', { enum: SEGMENT_STATES }).notNull(),
  firstWallTime: integer('first_wall_time').notNull(),
  lastWallTime: integer('last_wall_time').notNull(),
  bytes: integer('bytes').notNull(),
  records: integer('records').notNull(),
  counts: text('counts').notNull(),
  deletedAt: integer('deleted_at'),
  deletedBy: text('deleted_by'),
});

export const performanceMeta = sqliteTable('performance_meta', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});

export const CATALOG_DDL: ReadonlyArray<string> = [
  `create table if not exists performance_segment (
    started_at integer primary key not null,
    state text not null,
    first_wall_time integer not null,
    last_wall_time integer not null,
    bytes integer not null,
    records integer not null,
    counts text not null,
    deleted_at integer,
    deleted_by text
  )`,
  `create index if not exists performance_segment_window_idx on performance_segment (state, first_wall_time, last_wall_time)`,
  `create table if not exists performance_meta (
    key text primary key not null,
    value integer not null
  )`,
];
