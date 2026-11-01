import { Schema } from 'effect';
import { threadEntriesSchema, threadEntrySchema, threadTextSchema } from '@runlith/agent/protocol/realtime';
import { threadOpenTextSchema, threadPagePayloadSchema, threadEntryWireSchema } from '@runlith/agent/protocol/http';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import {
  threadCompositionReadingSchema,
  threadHeldSchema,
  threadWireSnapshotPayloadSchema,
} from '../../../../threads/contract/wire/snapshot.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const threadRead = {
  doors: { http: 'perform' },
  callers: 'operator',
  place: 'project',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;
const THREAD_READ_REFUSALS = ['unknown-project', 'not-found', 'foreign-project'] as const;

export const EVIDENCE_OPERATIONS = {
  read_thread_snapshot: operation('read_thread_snapshot', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning:
      "Read one native thread's snapshot: its row, the transcript's latest page, its active and latest runs, its pending input and its life.",
    input: Schema.Struct({ threadId: ThreadId }),
    answer: arms({ loaded: { snapshot: threadWireSnapshotPayloadSchema.fields.snapshot } }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the snapshot of ${input.threadId}?` }),
    confirmLabel: 'Read snapshot',
    presentation: { running: 'Reading a thread snapshot', done: 'Read a thread snapshot' },
  }),
  read_thread_held: operation('read_thread_held', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning: 'Read the resources one thread holds: each with its kind, what it names and when it was taken.',
    input: Schema.Struct({ threadId: ThreadId }),
    answer: arms({ read: threadHeldSchema.fields }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read what ${input.threadId} holds?` }),
    confirmLabel: 'Read held',
    presentation: { running: 'Reading what a thread holds', done: 'Read what a thread holds' },
  }),
  read_thread_composition: operation('read_thread_composition', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning: "Read what one thread's next request is made of, part by part, against its model's window.",
    input: Schema.Struct({ threadId: ThreadId }),
    answer: arms({ read: threadCompositionReadingSchema.fields }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the composition of ${input.threadId}?` }),
    confirmLabel: 'Read composition',
    presentation: { running: 'Reading a thread composition', done: 'Read a thread composition' },
  }),
  read_thread_entry: operation('read_thread_entry', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning: "Read one entry of a native thread's transcript by its entry id.",
    input: Schema.Struct({ threadId: ThreadId, ...threadEntrySchema.fields }),
    answer: arms({ found: { entry: threadEntryWireSchema }, absent: {} }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read entry ${input.entryId} of ${input.threadId}?` }),
    confirmLabel: 'Read entry',
    presentation: { running: 'Reading a transcript entry', done: 'Read a transcript entry' },
  }),
  read_thread_text: operation('read_thread_text', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning:
      "Read a range of one transcript entry's growing text — an answer, its reasoning or a tool's streamed input — by UTF-16 offset, open or recorded.",
    input: Schema.Struct({ threadId: ThreadId, ...threadTextSchema.fields }),
    answer: arms({ found: threadOpenTextSchema.fields, absent: {} }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the text of entry ${input.entryId} of ${input.threadId}?` }),
    confirmLabel: 'Read text',
    presentation: { running: 'Reading entry text', done: 'Read entry text' },
  }),
  read_thread_entries: operation('read_thread_entries', {
    approval: ASKS_NEVER,
    ...threadRead,
    meaning: "Read the page of a native thread's transcript that ends before a position.",
    input: Schema.Struct({ threadId: ThreadId, ...threadEntriesSchema.fields }),
    answer: arms({ read: threadPagePayloadSchema.fields }),
    refusals: THREAD_READ_REFUSALS,
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the transcript of ${input.threadId} before ${input.before}?` }),
    confirmLabel: 'Read entries',
    presentation: { running: 'Reading transcript entries', done: 'Read transcript entries' },
  }),
};

export type EvidenceOperationId = keyof typeof EVIDENCE_OPERATIONS;
