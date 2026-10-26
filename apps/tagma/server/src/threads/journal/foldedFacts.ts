import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { threadEntry } from '../store/kernel.js';
import { threadEvent } from '../store/journal.js';
import { payloadField, type PayloadField } from '../store/fields.js';

const BODY_IN_FOLD = 'bodyInFold' satisfies PayloadField;

const FOLDED_HEADER = ['type', 'id', 'runId', 'toolName', 'toolCallId', 'toolState', 'occurredAt'] as const;

export const bodyInFold = (payload: AnySQLiteColumn | SQL): SQL => sql`${payloadField(payload, BODY_IN_FOLD)} is not null`;

export const foldedToolPayload = (entry: SQL): SQL => {
  const fields = sql.join(
    FOLDED_HEADER.map((field) => sql`${field}, ${entry} -> ${`$.${field}`}`),
    sql`, `,
  );
  const absent = sql.join(
    FOLDED_HEADER.map((field) => sql`case when ${entry} -> ${`$.${field}`} is null then ${`$.${field}`} else '$.~' end`),
    sql`, `,
  );
  return sql`json_object('entry', json_remove(json_object(${fields}), ${absent}), ${BODY_IN_FOLD}, json('true'))`;
};

export const foldedBody: SQL = sql`${bodyInFold(threadEvent.payload)}
  and ${threadEntry.threadId} = ${threadEvent.threadId}
  and ${threadEntry.entryId} = ${payloadField(threadEvent.payload, 'entry.id')}`;

export function foldedToolFact(payload: ThreadEventPayloadValue, call: ThreadToolEntry): ThreadEventPayloadValue {
  return { ...payload, [BODY_IN_FOLD]: true, entry: Object.fromEntries(FOLDED_HEADER.map((field) => [field, call[field]])) };
}

export function foldedEntryId(payload: ThreadEventPayloadValue): string | null {
  if (payload[BODY_IN_FOLD] !== true) return null;
  const id = (payload as { entry?: { id?: unknown } }).entry?.id;
  return typeof id === 'string' ? id : null;
}

export function restoredFact(payload: ThreadEventPayloadValue, entry: unknown): ThreadEventPayloadValue {
  const answered: Record<string, unknown> = { ...payload };
  delete answered[BODY_IN_FOLD];
  if (entry !== undefined) answered.entry = entry;
  return answered;
}

export function toolEventIdentity(entry: ThreadTranscriptEntry | { readonly toolCallId: unknown; readonly runId: unknown }): string | null {
  const call = entry as { readonly toolCallId?: unknown; readonly runId?: unknown };
  if (typeof call.toolCallId !== 'string') return null;
  return `tool:${typeof call.runId === 'string' ? call.runId : ''}:${call.toolCallId}`;
}

export function eventIdentity(payload: ThreadEventPayloadValue): string | null {
  const entry = (payload as { entry?: { readonly id?: unknown; readonly toolCallId?: unknown; readonly runId?: unknown } }).entry;
  if (entry === undefined || entry === null) return null;
  if (typeof entry.toolCallId === 'string') return toolEventIdentity(entry as { toolCallId: unknown; runId: unknown });
  return typeof entry.id === 'string' ? entry.id : null;
}

export const toolsInFootprint = (payload: AnySQLiteColumn | SQL): SQL =>
  sql`${payloadField(payload, 'measurement.footprint.toolDigests')} is not null`;

export function footprintTools(payload: ThreadEventPayloadValue): readonly string[] | null {
  const digests = (payload as { measurement?: { footprint?: { toolDigests?: unknown } } }).measurement?.footprint?.toolDigests;
  return Array.isArray(digests) && digests.every((digest) => typeof digest === 'string') ? digests : null;
}

export function foldedFootprint(payload: ThreadEventPayloadValue): ThreadEventPayloadValue {
  const measurement = (payload as { measurement?: Record<string, unknown> }).measurement ?? {};
  return {
    ...payload,
    measurement: Object.fromEntries(Object.entries(measurement).filter(([key]) => key !== 'footprint')),
  };
}
