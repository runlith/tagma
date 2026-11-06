import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const ENTRY_FIELDS = [
  'id',
  'type',
  'runId',
  'toolCallId',
  'role',
  'text',
  'status',
  'generation',
  'action',
  'questionId',
  'approver',
  'declinedBy',
] as const;

export type EntryField = (typeof ENTRY_FIELDS)[number];

export type PayloadField = `entry.${EntryField}` | 'bodyInFold' | 'measurement.footprint.toolDigests';

export const PAYLOAD_FIELDS: readonly PayloadField[] = [
  ...ENTRY_FIELDS.map((field) => `entry.${field}` as const),
  'bodyInFold',
  'measurement.footprint.toolDigests',
];

export const MESSAGE_FIELDS = ['compaction'] as const;

export type MessageField = (typeof MESSAGE_FIELDS)[number];

type Body = AnySQLiteColumn | SQL;

const path = (field: string): SQL => sql.raw(`'$.${field}'`);

export const entryField = (entry: Body, field: EntryField): SQL => sql`json_extract(${entry}, ${path(field)})`;

export const entryFieldType = (entry: Body, field: EntryField): SQL => sql`json_type(${entry}, ${path(field)})`;

export const payloadField = (payload: Body, field: PayloadField): SQL => sql`json_extract(${payload}, ${path(field)})`;

export const messageFieldType = (message: Body, field: MessageField): SQL => sql`json_type(${message}, ${path(field)})`;
