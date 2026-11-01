import { Schema } from 'effect';
import {
  threadCompactResultSchema,
  threadCompactSchema,
  threadEntriesSchema,
  threadEntrySchema,
  threadModelSchema,
  threadTextSchema,
} from '@runlith/agent/protocol/realtime';
import { threadEntryPayloadSchema, threadOpenTextSchema, threadPagePayloadSchema } from '@runlith/agent/protocol/http';
import { feed } from '../../../platform/contract/wire/operation.js';
import { THREAD_AIM } from '../../../threads/contract/wire/feeds.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { COMPACTION_OPERATIONS } from './operations/compaction.js';

const REFUSALS = ['not-found', 'foreign-project', 'thread-gone', 'unknown-project'] as const;

const read = <
  const Id extends string,
  Params extends Schema.Codec<any, unknown, never, never>,
  Result extends Schema.Codec<any, unknown, never, never>,
>(
  id: Id,
  performs: string,
  params: Params,
  event: Result,
  refusals: readonly string[] = REFUSALS,
) => feed(id, { input: Schema.Struct({ ...THREAD_AIM, params }), event, refusals, callers: 'operator', stream: false, performs });

export const THREAD_COMPACT = feed('thread.compact', {
  input: Schema.Struct({ ...THREAD_AIM, params: Schema.optional(threadCompactSchema) }),
  event: threadCompactResultSchema,
  refusals: COMPACTION_OPERATIONS.compact_thread.refusals,
  callers: 'operator',
  stream: false,
  performs: 'compact_thread',
});
export const THREAD_MODEL = read('thread.model', 'set_thread_model', threadModelSchema, threadWireSnapshotPayloadSchema);
export const THREAD_ENTRY = {
  ...read('thread.entry', 'read_thread_entry', threadEntrySchema, threadEntryPayloadSchema),
  answer: (read: { readonly status: string; readonly entry?: unknown }) => (read.status === 'found' ? { entry: read.entry } : null),
};
export const THREAD_ENTRIES = read('thread.entries', 'read_thread_entries', threadEntriesSchema, threadPagePayloadSchema);
const THREAD_TEXT = {
  ...read('thread.text', 'read_thread_text', threadTextSchema, Schema.NullOr(threadOpenTextSchema)),
  answer: (read: { readonly status: string; readonly text?: string; readonly from?: number; readonly length?: number }) =>
    read.status === 'found' ? { text: read.text, from: read.from, length: read.length } : null,
};

export const THREAD_NATIVE_FEEDS = [THREAD_COMPACT, THREAD_MODEL, THREAD_ENTRY, THREAD_ENTRIES, THREAD_TEXT] as const;
