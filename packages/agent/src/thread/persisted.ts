import { Data, Result, Schema } from 'effect';
import { AgentCallMeasurement, AgentRequestFootprint } from '../agent/AgentCallMeasurement';
import { AgentPhase } from '../agent/AgentPhase';
import { RUN_STAGES } from '../transcript/live';
import { AgentApprovalMode } from '../agent/contracts';
import type { ThreadBornOf } from '../protocol/birth';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import type { ThreadContextReading, ThreadHistory, ThreadPendingInteraction, ThreadRunProgress, ThreadAuthority } from './rows';
import type { ThreadTranscript } from '../transcript/rows';
import { type ThreadEntryReader, ThreadEntryUndecodable } from '../transcript/kinds';
import { agentProfileSchema, type ThreadProfileBirth } from './agents/AgentProfile';
import { transportBindingSchema, type TransportBinding } from './record';
import { transportCapabilitiesSchema, type TransportCapabilities } from './record';
import { ThreadQuestionEntry, ThreadFailureDiagnostics, WithdrawnWords } from '../transcript/entries';
import type { ThreadEventPayload } from './events';
import { threadInboxItemSchema, type ThreadInboxItem, type ThreadInboxRow } from './storage/inbox';
import {
  threadNotificationRecordSchema,
  threadRunStopRequestSchema,
  threadSettledBySchema,
  type ThreadNotificationRecord,
  type ThreadRunStopRequest,
} from './storage/settlement';

const extras = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const open = <const Fields extends Schema.Struct.Fields>(fields: Fields) => Schema.StructWithRest(Schema.Struct(fields), extras);

const entryShape = open({
  type: Schema.String.check(Schema.isMinLength(1)),
  id: Schema.String.check(Schema.isMinLength(1)),
});

export const runHaltSchema = Schema.Struct({ reason: Schema.String });

export const threadRunProgressSchema = Schema.Struct({
  stage: Schema.NullOr(Schema.Literals(RUN_STAGES)),
  message: Schema.NullOr(Schema.String),
  halt: Schema.optional(runHaltSchema),
  phase: Schema.optional(AgentPhase),
});

export const threadCallMeasurementSchema = Schema.Struct({
  ...AgentCallMeasurement.fields,
  footprint: Schema.optional(AgentRequestFootprint),
});
export type ThreadCallMeasurement = typeof threadCallMeasurementSchema.Type;

export const threadStepContextSchema = Schema.Struct({
  runId: Schema.String,
  stepNumber: Schema.Number,
  activity: Schema.optional(Schema.String),
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  contextWindow: Schema.NullOr(Schema.Number),
  inputLimit: Schema.optional(Schema.NullOr(Schema.Number)),
  measuredAt: Schema.String,
});

export const threadContextRecordSchema = Schema.Struct({
  generation: Schema.Number,
  sourceKey: Schema.String,
  requestId: Schema.String,
});

export const threadContextEvidenceSchema = Schema.Struct({
  instructions: Schema.String,
  tools: Schema.Array(Schema.String),
  profileId: Schema.NullOr(Schema.String),
  approvalMode: AgentApprovalMode,
});

export const threadContextChangeSchema = Schema.Struct({
  requestId: Schema.String,
  runId: Schema.String,
  sourceKey: Schema.String,
  fromGeneration: Schema.Number,
  outcome: Schema.Literals(['pending', 'published', 'denied']),
  record: Schema.optional(threadContextRecordSchema),
  evidence: Schema.optional(threadContextEvidenceSchema),
  stepNumber: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
  requestedAt: Schema.String,
  settledAt: Schema.optional(Schema.String),
});

export const threadRewindScopeSchema = Schema.Literals(['from', 'turn']);

const historyIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const facet = <S extends Schema.Top>(schema: S) => Schema.optional(schema);

export const threadEventPayloadSchema = Schema.Struct({
  bodyInFold: facet(Schema.Boolean),
  entry: facet(entryShape),
  messages: facet(Schema.Array(Message)),
  runId: facet(Schema.String),
  usage: facet(Usage),
  context: facet(threadStepContextSchema),
  measurement: facet(threadCallMeasurementSchema),
  contextChange: facet(threadContextChangeSchema),
  withdrawn: facet(Schema.Struct({ runId: Schema.String, keepMessages: historyIndex })),
  compacted: facet(Schema.Struct({ keepFrom: historyIndex, messages: Schema.Array(Message) })),
  rewound: facet(
    Schema.Struct({
      id: Schema.String,
      scope: threadRewindScopeSchema,
      runIds: Schema.Array(Schema.String),
      cuts: Schema.Array(Schema.Struct({ from: historyIndex, to: historyIndex })),
    }),
  ),
  restored: facet(
    Schema.Struct({
      rewindId: Schema.String,
      runIds: Schema.Array(Schema.String),
      inserts: Schema.Array(Schema.Struct({ at: historyIndex, messages: Schema.Array(Message) })),
    }),
  ),
  branched: facet(
    Schema.Struct({
      hidden: Schema.Array(Schema.String),
      prompts: Schema.Literals(['kept', 'dropped']),
      from: Schema.NullOr(Schema.String),
      cuts: Schema.Array(Schema.Struct({ from: historyIndex, to: historyIndex })),
    }),
  ),
});

const facetNamesSchema = Schema.Struct(
  Object.fromEntries(Object.keys(threadEventPayloadSchema.fields).map((name) => [name, Schema.optional(Schema.Unknown)])),
);
const readFacetNames = Schema.decodeUnknownResult(facetNamesSchema);
const readFacets = Schema.decodeUnknownResult(threadEventPayloadSchema);

export const decodeThreadEventFacetsResult = (value: unknown): Result.Result<typeof threadEventPayloadSchema.Type, Schema.SchemaError> => {
  const named = readFacetNames(value, { onExcessProperty: 'error' });
  return Result.isFailure(named) ? Result.fail(named.failure) : readFacets(value);
};

export const decodeThreadEventPayloadResult = (
  kinds: ThreadEntryReader,
  value: unknown,
): Result.Result<ThreadEventPayload, Schema.SchemaError | ThreadEntryUndecodable> => {
  const formed = kinds.formEvent(value);
  if (Result.isFailure(formed)) return Result.fail(new ThreadEntryUndecodable({ type: null, id: null, issue: formed.failure.message }));
  const facets = decodeThreadEventFacetsResult(formed.success);
  if (Result.isFailure(facets)) return facets;
  const { entry: shape, ...rest } = facets.success;
  if (shape === undefined) return Result.succeed(rest);
  const entry = kinds.read(shape);
  return Result.isFailure(entry) ? Result.fail(entry.failure) : Result.succeed({ ...rest, entry: entry.success });
};

export const threadContextReadingSchema = Schema.Struct({
  usage: Usage,
  contextWindow: Schema.NullOr(Schema.Number),
  inputLimit: Schema.optional(Schema.NullOr(Schema.Number)),
  footprint: Schema.optional(AgentRequestFootprint),
  attempt: Schema.optional(Schema.Number),
  historyMessages: Schema.optional(Schema.Number),
  runId: Schema.String,
  stepNumber: Schema.Number,
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  account: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
  measuredAt: Schema.String,
  sentAt: Schema.optional(Schema.String),
  cache: Schema.optional(Schema.Struct({ ttlSeconds: Schema.NullOr(Schema.Number) })),
  stale: Schema.Boolean,
  staleBy: Schema.optional(Schema.Literal('rewind')),
});

const decodeHistory = Schema.decodeUnknownResult(Schema.Array(Message));
const decodeProgress = Schema.decodeUnknownResult(threadRunProgressSchema);
const decodeUsage = Schema.decodeUnknownResult(Usage);
const decodeFailure = Schema.decodeUnknownResult(ThreadFailureDiagnostics);
const decodeReading = Schema.decodeUnknownResult(threadContextReadingSchema);
const decodeInboxItem = Schema.decodeUnknownResult(threadInboxItemSchema);

export function parseThreadHistory(value: unknown): ThreadHistory {
  const parsed = decodeHistory(value);
  if (parsed._tag !== 'Success') refuse('history', parsed.failure);
  return parsed.success;
}

export function parseThreadStreamTail(kinds: ThreadEntryReader, value: unknown): ThreadTranscript | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error('Persisted thread stream tail cannot be read — expected a list of entries');
  return value.map((entry) => {
    const read = kinds.decode(entry);
    if (Result.isFailure(read)) throw new Error(`Persisted thread stream tail cannot be read — ${read.failure.message}`);
    return read.success;
  });
}

const decodeQuestion = Schema.decodeUnknownResult(ThreadQuestionEntry);

export function parseThreadPendingInteraction(kinds: ThreadEntryReader, value: unknown): ThreadPendingInteraction {
  if (value === null || value === undefined) return null;
  const formed = kinds.form('entry', value);
  if (Result.isFailure(formed)) throw new Error(`Persisted pending interaction cannot be read — ${formed.failure.message}`);
  const parsed = decodeQuestion(formed.success, { onExcessProperty: 'error' });
  if (parsed._tag !== 'Success') refuse('pending interaction', parsed.failure);
  return parsed.success;
}

export function parseThreadRunProgress(value: unknown): ThreadRunProgress {
  const parsed = decodeProgress(value);
  if (parsed._tag !== 'Success') refuse('run progress', parsed.failure);
  return parsed.success;
}

export function parseThreadRunUsage(value: unknown): Usage | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeUsage(value);
  if (parsed._tag !== 'Success') refuse('run usage', parsed.failure);
  return parsed.success;
}

const decodeNotification = Schema.decodeUnknownResult(threadNotificationRecordSchema);
const decodeSettledBy = Schema.decodeUnknownResult(threadSettledBySchema);

export function parseThreadRunNotification(value: unknown): ThreadNotificationRecord | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeNotification(value);
  if (parsed._tag !== 'Success') refuse('run notification', parsed.failure);
  return parsed.success;
}

const decodeStopRequest = Schema.decodeUnknownResult(threadRunStopRequestSchema);

export function parseThreadRunStopRequest(value: unknown): ThreadRunStopRequest | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeStopRequest(value);
  if (parsed._tag !== 'Success') refuse('run stop request', parsed.failure);
  return parsed.success;
}

const decodeWithdrawnWords = Schema.decodeUnknownResult(WithdrawnWords);

export function parseWithdrawnWords(value: unknown): WithdrawnWords | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeWithdrawnWords(value);
  if (parsed._tag !== 'Success') refuse('withdrawn words', parsed.failure);
  return parsed.success;
}

export function parseThreadSettledBy(value: unknown): typeof threadSettledBySchema.Type {
  if (value === null || value === undefined) return null;
  const parsed = decodeSettledBy(value);
  if (parsed._tag !== 'Success') refuse('run ending actor', parsed.failure);
  return parsed.success;
}

export function parseThreadRunFailure(value: unknown): ThreadFailureDiagnostics | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeFailure(value);
  if (parsed._tag !== 'Success') refuse('run failure', parsed.failure);
  return parsed.success;
}

export function parseThreadInboxItem(row: ThreadInboxRow): ThreadInboxItem {
  return readInboxItem(null, row);
}

export function readInboxItem(kinds: ThreadEntryReader | null, row: ThreadInboxRow): ThreadInboxItem {
  const value = {
    id: row.id,
    threadId: row.threadId,
    sender: row.sender,
    kind: row.kind,
    body: row.body,
    state: row.state,
    deliveredToRunId: row.deliveredToRunId,
    occurredAt: row.occurredAt.toISOString(),
  };
  const formed = kinds?.form('inbox', value) ?? Result.succeed(value);
  if (Result.isFailure(formed)) throw new Error(`Persisted inbox item cannot be read — ${formed.failure.message}`);
  const parsed = decodeInboxItem(formed.success);
  if (parsed._tag !== 'Success') refuse('inbox item', parsed.failure);
  return parsed.success;
}

export function parseThreadContextReading(kinds: ThreadEntryReader, value: unknown): ThreadContextReading | null {
  if (value === null || value === undefined) return null;
  const formed = kinds.form('reading', value);
  if (Result.isFailure(formed)) throw new Error(`Persisted context reading cannot be read — ${formed.failure.message}`);
  const parsed = decodeReading(formed.success);
  if (parsed._tag !== 'Success') refuse('context reading', parsed.failure);
  return parsed.success;
}

export const threadBornOfSchema = Schema.Struct({
  by: Schema.String.check(Schema.isMinLength(1)),
  step: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ask: Schema.optional(Schema.Literal(true)),
});

const decodeBornOf = Schema.decodeUnknownResult(threadBornOfSchema);

export function parseThreadBornOf(value: unknown): ThreadBornOf | null {
  if (value === null || value === undefined) return null;
  const parsed = decodeBornOf(value);
  if (parsed._tag !== 'Success') refuse('born-of', parsed.failure);
  return parsed.success;
}

export const threadAuthoritySchema = Schema.Struct({
  mode: AgentApprovalMode,
  bypassFrom: Schema.NullOr(Schema.String),
});

const decodeAuthority = Schema.decodeUnknownResult(threadAuthoritySchema);

export function parseThreadAuthority(value: unknown): ThreadAuthority {
  const parsed = decodeAuthority(value);
  if (parsed._tag !== 'Success') refuse('authority', parsed.failure);
  return parsed.success;
}

const decodeTransport = Schema.decodeUnknownResult(transportBindingSchema);

export function parseTransportBinding(value: unknown): TransportBinding {
  const parsed = decodeTransport(value);
  if (parsed._tag !== 'Success') refuse('transport binding', parsed.failure);
  return parsed.success;
}

const decodeCapabilities = Schema.decodeUnknownResult(transportCapabilitiesSchema);

export function parseTransportCapabilities(value: unknown): TransportCapabilities {
  const parsed = decodeCapabilities(value);
  if (parsed._tag !== 'Success') refuse('transport capabilities', parsed.failure);
  return parsed.success;
}

export const threadProfileBirthSchema = Schema.Struct({
  id: Schema.String,
  overlay: Schema.Struct({
    ...agentProfileSchema.fields,
    id: Schema.String,
    description: Schema.String,
  }),
});

const decodeProfile = Schema.decodeUnknownResult(Schema.NullOr(threadProfileBirthSchema));

export function parseThreadProfile(value: unknown): ThreadProfileBirth | null {
  const parsed = decodeProfile(value ?? null);
  if (parsed._tag !== 'Success') refuse('profile', parsed.failure);
  return parsed.success;
}

function refuse(what: string, error: Schema.SchemaError): never {
  throw new Error(`Persisted thread ${what} cannot be read — ${error.message}`);
}

export function causeSentence(cause: unknown): string {
  const said = cause instanceof Error ? cause.message : String(cause);
  const own = said.length > 0 ? said : `${cause instanceof Error ? cause.name : typeof cause} carried no message`;
  if (!(cause instanceof Error) || cause.cause === undefined || cause.cause === null) return own;
  return `${own}; caused by: ${causeSentence(cause.cause)}`;
}

export class ThreadStorageFailed extends Data.TaggedError('ThreadStorageFailed')<{
  readonly call: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Thread storage failed in ${this.call}: ${causeSentence(this.cause)}`;
  }
}
