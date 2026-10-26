import { runStatusSchema } from '@runlith/agent/protocol/http';
import { Schema, Struct } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { runEndingSchema, threadAskSchema, threadSelectionSchema } from './list.js';

const threadId = Schema.String.check(Schema.isMinLength(1));
const revision = Schema.Int.check(Schema.isGreaterThan(0));

export const presenceFieldsSchema = Schema.Struct({
  status: runStatusSchema,
  activeRunStartedAt: Schema.NullOr(Schema.String),
  ask: Schema.NullOr(threadAskSchema),
  saidLine: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(runEndingSchema),
  model: threadSelectionSchema,
  archived: Schema.Boolean,
});
export type PresenceFields = typeof presenceFieldsSchema.Type;

export const presenceTailSchema = Schema.Struct({ runId: Schema.String, entryId: Schema.String, text: Schema.String });
export type PresenceTail = typeof presenceTailSchema.Type;

export const presenceTailStepSchema = Schema.Union([
  Schema.Struct({ restart: Schema.Literal(true), runId: Schema.String, entryId: Schema.String, text: Schema.String }),
  Schema.Struct({ restart: Schema.Literal(false), text: Schema.String, drop: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
]);
export type PresenceTailStep = typeof presenceTailStepSchema.Type;

export const presenceRowSchema = Schema.Struct({ threadId, ...presenceFieldsSchema.fields, tail: Schema.optional(presenceTailSchema) });
export type PresenceRow = typeof presenceRowSchema.Type;

export const presenceChangeSchema = presenceFieldsSchema.mapFields(Struct.map(Schema.optionalKey));
export type PresenceChange = typeof presenceChangeSchema.Type;

export const PRESENCE_MISSING = ['not-found', 'foreign-project', 'deleted'] as const;
export type PresenceMissingReason = (typeof PRESENCE_MISSING)[number];

const presenceMissingSchema = Schema.Struct({
  type: Schema.tag('missing'),
  threadId,
  reason: Schema.Literals(PRESENCE_MISSING),
});

const presenceEntrySchema = Schema.Union([
  Schema.Struct({ type: Schema.tag('row'), revision, row: presenceRowSchema }),
  presenceMissingSchema,
]).pipe(Schema.toTaggedUnion('type'));
export type PresenceEntry = typeof presenceEntrySchema.Type;

export const presenceEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.tag('initial'), entries: Schema.Array(presenceEntrySchema) }),
  Schema.Struct({ type: Schema.tag('changed'), threadId, revision, fields: presenceChangeSchema }),
  Schema.Struct({
    type: Schema.tag('tail'),
    threadId,
    revision,
    tail: Schema.NullOr(presenceTailStepSchema),
  }),
  presenceMissingSchema,
]).pipe(Schema.toTaggedUnion('type'));
export type PresenceEvent = typeof presenceEventSchema.Type;

export const PRESENCE_FEED = feed('threads.presence', {
  graph: 'none',
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    threadIds: Schema.Array(threadId).check(Schema.isMinLength(1)),
  }),
  event: presenceEventSchema,
  refusals: [],
  callers: 'operator',
});
