import { PageCursor } from '@runlith/paging';
import { Schema } from 'effect';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { serializedThreadRunSchema, serializedThreadSchema } from '@runlith/agent/protocol/http';
import { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { threadEventPayloadSchema } from '@runlith/agent/thread/persisted';
import { threadNotificationSchema } from '@runlith/agent/thread/storage/settlement';
import { THREAD_QUERY_SOURCES } from '@runlith/agent/protocol/threadQuery';
import { harnessRowSchema } from './harness/externalSession.js';
import { recapLineSchema, recapReadingSchema } from './recap.js';

export const threadActsSchema = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  entries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  blocks: Schema.Array(Schema.String),
  bounded: Schema.Boolean,
});

export const threadShapeSchema = Schema.Struct({
  thread: Schema.Struct({
    ...serializedThreadSchema.fields,
    title: Schema.String,
    projectId: Schema.Int,
    scope: Schema.NullOr(Schema.String),
    systemPrompt: Schema.NullOr(Schema.String),
    cacheWarmth: Schema.NullOr(ThreadCacheWarmth),
    contextLimit: Schema.NullOr(ThreadContextLimit),
    harness: Schema.NullOr(harnessRowSchema),
  }),
  entries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runs: Schema.Array(Schema.Struct({ ...serializedThreadRunSchema.fields, notification: Schema.NullOr(threadNotificationSchema) })),
  acts: threadActsSchema,
  recap: Schema.optional(recapReadingSchema),
});
export type ThreadShape = typeof threadShapeSchema.Type;

export const threadJournalEntrySchema = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThan(0)),
  id: Schema.String,
  kind: Schema.String,
  origin: Schema.Literals(['own', 'inherited', 'unknown']),
  ...threadEventPayloadSchema.fields,
});

export type ThreadJournalEntry = typeof threadJournalEntrySchema.Type;

const expandedJournalEntrySchema = Schema.StructWithRest(threadJournalEntrySchema, [Schema.Record(Schema.String, Schema.Any)]);

export const expandedRecordSchema = Schema.Union([
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    record: expandedJournalEntrySchema,
  }),
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    fact: Schema.Record(Schema.String, Schema.Any),
  }),
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    missing: Schema.String,
  }),
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    unread: Schema.String,
  }),
  Schema.Struct({
    threadId: Schema.String,
    at: Schema.Union([Schema.Int, Schema.String]),
    output: Schema.Struct({
      text: Schema.String,
      from: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      next: Schema.NullOr(Schema.Int),
    }),
  }),
]);
export type ExpandedRecord = typeof expandedRecordSchema.Type;

export const evidenceThreadSchema = Schema.Struct({ threadId: Schema.String, head: Schema.Int });
export type EvidenceThread = typeof evidenceThreadSchema.Type;

export const evidenceAnswerSchema = Schema.Struct({
  select: Schema.Literals(THREAD_QUERY_SOURCES),
  threads: Schema.Array(evidenceThreadSchema),
  over: Schema.Int,
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Any)),
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        by: Schema.Record(Schema.String, Schema.Any),
        absent: Schema.optional(Schema.Array(Schema.String)),
        count: Schema.optional(Schema.Int),
        sum: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
        unknown: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
      }),
    ),
  ),
  coverage: Schema.Struct({
    complete: Schema.Boolean,
    unavailable: Schema.Array(Schema.String),
    truncated: Schema.Boolean,
    read: Schema.Int,
    cut: Schema.optional(Schema.Literal('read-ceiling')),
    lost: Schema.optional(
      Schema.Array(
        Schema.Struct({
          scope: Schema.optional(Schema.Literal('global')),
          unknown: Schema.optional(Schema.Boolean),
          cause: Schema.String,
          facts: Schema.Int,
          bodies: Schema.Int,
          bytes: Schema.Int,
        }),
      ),
    ),
  }),
  cursor: Schema.NullOr(PageCursor),
});
export type EvidenceAnswer = typeof evidenceAnswerSchema.Type;

export const threadFactsSchema = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  agentId: Schema.String,
  name: Schema.NullOr(Schema.String),
  parentThreadId: Schema.NullOr(ThreadId),
  spawnRootId: Schema.String,
  status: Schema.String,
  activeRunId: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(
    Schema.Struct({
      runId: Schema.String,
      status: Schema.String,
      failureReason: Schema.NullOr(Schema.String),
      finishedAt: Schema.String,
    }),
  ),
  thread: Schema.Struct({
    provider: Schema.String,
    model: Schema.NullOr(Schema.String),
    reasoning: Schema.NullOr(Schema.String),
  }),
  run: Schema.NullOr(
    Schema.Struct({
      runId: Schema.String,
      provider: Schema.NullOr(Schema.String),
      model: Schema.NullOr(Schema.String),
      reasoning: Schema.NullOr(Schema.String),
    }),
  ),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  readerOrderAt: Schema.String,
  pinnedAt: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(harnessRowSchema),
  recap: Schema.optional(recapLineSchema),
});
export type ThreadFacts = typeof threadFactsSchema.Type;

export const threadRolloutSchema = Schema.Struct({
  threadId: Schema.String,
  path: Schema.NullOr(Schema.String),
  fileForm: Schema.Literals(['plain', 'compressed', 'missing']),
  refusal: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literals(['out-of-order', 'corrupt', 'conflict', 'io']),
      message: Schema.String,
      nextByteOffset: Schema.Int,
      nextPosition: Schema.Int,
      seenAt: Schema.String,
    }),
  ),
  file: Schema.Array(
    Schema.Struct({
      byteOffset: Schema.Int,
      position: Schema.NullOr(Schema.Int),
      id: Schema.NullOr(Schema.String),
      kind: Schema.String,
    }),
  ),
  bounded: Schema.Boolean,
  rows: Schema.Array(Schema.Struct({ position: Schema.Int, id: Schema.String, kind: Schema.String })),
});
export type ThreadRolloutDisagreement = typeof threadRolloutSchema.Type;

export const rolloutRepairSchema = Schema.Struct({
  repair: Schema.Struct({
    threadId: Schema.String,
    path: Schema.String,
    kept: Schema.String,
    records: Schema.Int,
    renumbered: Schema.Int,
  }),
  projected: Schema.NullOr(Schema.Int),
});
export type RolloutRepair = typeof rolloutRepairSchema.Type;
export type RolloutRepairStatus = RolloutRepair['repair'];
export type ThreadRolloutFileRecord = ThreadRolloutDisagreement['file'][number];
export type ThreadRolloutRowRecord = ThreadRolloutDisagreement['rows'][number];
