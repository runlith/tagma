import { Effect, Option, Predicate, Result, Schema, SchemaGetter, SchemaIssue } from 'effect';
import {
  makeThreadEntryReader,
  ThreadEntryKinds,
  ThreadEntryUndecodable,
  ThreadEntryUnreadable,
  unreadableEntry,
} from '../transcript/kinds';
import { AgentPhase } from '../agent/AgentPhase';
import { AgentSignalNotice } from '../agent/contracts';
import { RUN_ENDINGS, RUN_STAGES, WORDS_WAITS } from '../transcript/live';
import { THREAD_ATTACHMENT_MEDIA_TYPES } from '../transcript/attachments';
import { capOpenEntries, capTranscript, capTranscriptEntry } from '../transcript/cap';
import { ThreadAttachment, ThreadFailureDiagnostics, ThreadMessageEntry, ThreadSignalEntry, WithdrawnWords } from '../transcript/entries';
import { ThreadRewindMark, type ThreadEventDelta } from '../transcript/eventFold';
import type { ThreadTranscriptPage } from '../transcript/rows';
import type { ThreadSnapshot, ThreadState } from '../thread/state';
import type {
  FeedPosition,
  RunStatus,
  ThreadFeedEvent,
  ThreadFeedSnapshot,
  ThreadOpenChange,
  ThreadPendingInput,
  ThreadResumeOf,
} from '../transcript/live';
import type { ThreadRunRow, ThreadRunStatus, ThreadStatus } from '../thread/rows';
import { threadNotificationRecordSchema, threadSettledBySchema } from '../thread/storage/settlement';
import { threadSummarizerSelectionSchema } from '../thread/storage/inbox';
import { UNREAD_FACTS, transportBindingSchema } from '../thread/record';
import { agentTypeId } from '../thread/agents/AgentProfile';
import { transportCapabilitiesSchema } from '../thread/record';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import { Usage } from '@runlith/llm/schema/events';
import {
  threadBornOfSchema,
  threadContextReadingSchema,
  threadAuthoritySchema,
  threadProfileBirthSchema,
  threadRewindScopeSchema,
  threadRunProgressSchema,
  runHaltSchema,
} from '../thread/persisted';

const coreEntries = makeThreadEntryReader({ products: [] });
const unreadableWire = Schema.toCodecJson(
  Schema.Struct({
    type: Schema.Literal('entry-unreadable'),
    id: Schema.NonEmptyString,
    runId: Schema.optional(Schema.String),
    occurredAt: Schema.optional(Schema.String),
    rewound: Schema.optional(ThreadRewindMark),
    refused: Schema.Struct({ type: Schema.NullOr(Schema.String), issue: Schema.String }),
  }),
);
const writeUnreadable = Schema.encodeUnknownResult(unreadableWire);
const readUnreadable = Schema.decodeUnknownResult(unreadableWire);
const entryValue = Schema.declare<ThreadTranscriptEntry>(
  (value): value is ThreadTranscriptEntry => Predicate.isObject(value) && typeof value.type === 'string' && typeof value.id === 'string',
  {
    toCodecArbitrary: () =>
      Schema.link<ThreadTranscriptEntry>()(ThreadMessageEntry, {
        decode: SchemaGetter.passthroughSupertype(),
        encode: SchemaGetter.forbiddenEncoding,
      }),
  },
);
const installedKinds = Effect.map(
  Effect.serviceOption(ThreadEntryKinds),
  Option.getOrElse(() => coreEntries),
);
const writeEntry = Effect.fnUntraced(function* (entry: ThreadTranscriptEntry) {
  if (ThreadEntryUnreadable.is(entry)) {
    const { type, issue } = entry.refusal;
    const diagnosis = writeUnreadable({
      type: entry.type,
      id: entry.id,
      runId: entry.runId,
      occurredAt: entry.occurredAt,
      rewound: entry.rewound,
      refused: { type, issue },
    });
    if (Result.isSuccess(diagnosis)) return diagnosis.success;
    return yield* Effect.fail(new SchemaIssue.InvalidValue({ message: diagnosis.failure.message }));
  }
  const written = (yield* installedKinds).writeWire(entry);
  if (Result.isSuccess(written)) return written.success;
  return yield* Effect.fail(new SchemaIssue.InvalidValue({ message: written.failure.message }));
});
const readEntry = Effect.fnUntraced(function* (value: unknown) {
  if (Predicate.isObject(value) && value.type === 'entry-unreadable') {
    const diagnosis = readUnreadable(value);
    if (Result.isSuccess(diagnosis)) {
      const { refused, ...identity } = diagnosis.success;
      return new ThreadEntryUnreadable(identity, new ThreadEntryUndecodable({ type: refused.type, id: identity.id, issue: refused.issue }));
    }
  }
  const read = (yield* installedKinds).readWire(value);
  if (Result.isSuccess(read)) return read.success;
  const unreadable = unreadableEntry(value, read.failure);
  if (unreadable !== null) return unreadable;
  return yield* Effect.fail(new SchemaIssue.InvalidValue({ message: read.failure.message }));
});

export const threadEntryWireSchema = Schema.Unknown.pipe(
  Schema.decodeTo(entryValue, {
    decode: SchemaGetter.transformEffect(readEntry),
    encode: SchemaGetter.transformEffect(writeEntry),
  }),
);

export const threadAttachmentMediaTypeSchema = Schema.Literals(THREAD_ATTACHMENT_MEDIA_TYPES);

export type ThreadAttachmentUploadPayload = {
  status: 'uploaded';
  attachment: { id: string };
};

type SerializedThreadSource = ThreadSnapshot['thread'];

export type SerializedThread = Omit<
  SerializedThreadSource,
  'pendingInteraction' | 'cacheGroup' | 'bindings' | 'createdAt' | 'updatedAt' | 'bornOf'
> & {
  bornOf?: SerializedThreadSource['bornOf'];
  createdAt: string;
  updatedAt: string;
};

export type SerializedThreadRun = Omit<
  ThreadRunRow,
  | 'approvalMode'
  | 'origin'
  | 'interactive'
  | 'streamTail'
  | 'cost'
  | 'handedOverAt'
  | 'resumes'
  | 'settledNotifyAttempts'
  | 'stopRequest'
  | 'withdrawnWords'
  | 'createdAt'
  | 'startedAt'
  | 'heartbeatAt'
  | 'finishedAt'
  | 'settledNotifiedAt'
  | 'updatedAt'
> & {
  createdAt: string;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  updatedAt: string;
};

export type ThreadStateView = {
  readonly thread: SerializedThread;
  readonly activeRun: SerializedThreadRun | null;
  readonly latestRun: SerializedThreadRun | null;
  readonly pendingInput: ThreadPendingInput;
  readonly status: RunStatus;
  readonly now: string;
};

export type ThreadSnapshotPayload = {
  readonly status: 'loaded';
  readonly snapshot: ThreadFeedSnapshot<ThreadStateView>;
};

export type ThreadPagePayload = {
  entries: readonly ThreadTranscriptEntry[];
  before: number | null;
};

export function threadStateView(state: ThreadState): ThreadStateView {
  return {
    thread: serializeThread(state.thread),
    activeRun: state.activeRun ? serializeRun(state.activeRun) : null,
    latestRun: state.latestRun ? serializeRun(state.latestRun) : null,
    pendingInput: state.pendingInput,
    status: state.status,
    now: state.now,
  };
}

export function threadSnapshotPayload(snapshot: ThreadSnapshot): ThreadSnapshotPayload {
  return {
    status: 'loaded',
    snapshot: {
      ...threadStateView(snapshot),
      transcript: capTranscript(snapshot.transcript),
      before: snapshot.before,
      open: capOpenEntries(snapshot.live.open),
      progress: snapshot.live.progress,
    },
  };
}

export function threadPagePayload(page: ThreadTranscriptPage): ThreadPagePayload {
  return { entries: capTranscript(page.entries), before: page.before };
}

export function threadFeedRecords(deltas: readonly ThreadEventDelta[]): readonly ThreadEventDelta[] {
  return deltas.map((delta) => (delta.entry ? { ...delta, entry: capTranscriptEntry(delta.entry) } : delta));
}

export function threadOpenChange(change: ThreadOpenChange): ThreadOpenChange {
  return change.op === 'put' ? { op: 'put', entry: capTranscriptEntry(change.entry), from: change.from } : change;
}

export function threadSnapshotEvent(snapshot: ThreadSnapshot): ThreadFeedEvent<ThreadStateView> {
  return { type: 'snapshot', at: snapshot.live.at, payload: threadSnapshotPayload(snapshot) };
}

export function threadResumeEvent(resumed: ThreadResumeOf<ThreadState>, from: FeedPosition): ThreadFeedEvent<ThreadStateView> {
  return {
    type: 'resume',
    at: resumed.live.at,
    payload: {
      from,
      records: threadFeedRecords(resumed.deltas),
      open: capOpenEntries(resumed.live.open),
      progress: resumed.live.progress,
      snapshot: threadStateView(resumed.state),
    },
  };
}

const isoString = Schema.String;

export const threadQueuedTurnSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  kind: Schema.optional(Schema.Literal('compaction')),
  text: Schema.String,
  keep: Schema.optional(Schema.String),
  summarizer: Schema.optional(threadSummarizerSelectionSchema),
  attachments: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
  from: Schema.optional(Schema.String),
  senderThreadId: Schema.optional(Schema.String),
  senderProjectId: Schema.optional(Schema.Number),
  intent: Schema.optional(Schema.String),
  notice: Schema.optional(AgentSignalNotice),
  occurredAt: Schema.String,
});
const threadWaitingTurnSchema = Schema.Struct({
  ...threadQueuedTurnSchema.fields,
  attachments: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, ...ThreadAttachment.fields }))),
});
export const threadPendingInputSchema = Schema.Struct({
  queued: Schema.Array(threadWaitingTurnSchema),
  steers: Schema.Array(threadWaitingTurnSchema),
  arrived: Schema.optional(Schema.Array(ThreadSignalEntry)),
});

const threadStatusSchema = Schema.Literals(['idle', 'running', 'failed']);
export const runLifeSchema = Schema.Literals(['idle', 'working', 'awaiting', 'stalled']);

export const runStatusEndingSchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(RUN_ENDINGS),
  stoppedBy: Schema.NullOr(Schema.Literals(['reader', 'parent', 'agent', 'model'])),
  failureReason: Schema.NullOr(Schema.String),
  finishedAt: isoString,
  notification: Schema.Literals(['confirmed', 'claimed', 'retry-wait', 'notification-exhausted']),
  words: Schema.optional(WithdrawnWords),
});

export const runStatusSchema = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.NullOr(Schema.String),
  life: runLifeSchema,
  stage: Schema.NullOr(Schema.Literals(RUN_STAGES)),
  openQuestions: Schema.Array(Schema.String),
  since: Schema.NullOr(isoString),
  ownership: Schema.optional(Schema.Literals(['held', 'stale-evidence', 'recovering'])),
  halt: Schema.optional(runHaltSchema),
  ending: Schema.optional(runStatusEndingSchema),
  launchBlocked: Schema.optional(Schema.Literal(true)),
  wordsWait: Schema.optional(Schema.Literals(WORDS_WAITS)),
  receipts: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      status: Schema.Literals(['queued', 'steered']),
      runId: Schema.String,
      itemId: Schema.String,
      occurredAt: isoString,
    }),
  ),
});
const threadRunStatusSchema = Schema.Literals(['running', ...RUN_ENDINGS]);

export const serializedThreadSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  agentId: Schema.String,
  parentThreadId: Schema.NullOr(Schema.String),
  spawnedByRunId: Schema.NullOr(Schema.String),
  bornOf: Schema.optionalKey(Schema.NullOr(threadBornOfSchema)),
  spawnRootId: Schema.String,
  name: Schema.NullOr(Schema.String),
  authority: threadAuthoritySchema,
  plain: Schema.Boolean,
  profile: Schema.NullOr(threadProfileBirthSchema),
  budgetTokens: Schema.NullOr(Schema.Int),
  hostKind: Schema.NullOr(Schema.String),
  hostId: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  switches: Schema.Record(Schema.String, Schema.String),
  transport: transportBindingSchema,
  capabilities: transportCapabilitiesSchema,
  unread: Schema.optional(Schema.Array(Schema.Literals(UNREAD_FACTS))),
  status: threadStatusSchema,
  failureReason: Schema.NullOr(Schema.String),
  contextReading: Schema.NullOr(threadContextReadingSchema),
  createdBy: Schema.NullOr(Schema.String),
  createdAt: isoString,
  updatedAt: isoString,
});

export const serializedThreadRunSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  status: threadRunStatusSchema,
  kind: Schema.Literals(['turn', 'keep-warm', 'compaction']),
  ownerId: Schema.String,
  account: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  switches: Schema.Record(Schema.String, Schema.String),
  progress: threadRunProgressSchema,
  usage: Schema.NullOr(Usage),
  failureReason: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(ThreadFailureDiagnostics),
  settledBy: threadSettledBySchema,
  settledNotification: Schema.NullOr(threadNotificationRecordSchema),
  createdAt: isoString,
  startedAt: isoString,
  heartbeatAt: isoString,
  finishedAt: Schema.NullOr(isoString),
  updatedAt: isoString,
});

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SerializedThreadProjectsForm = Assert<Exact<typeof serializedThreadSchema.Type, SerializedThread>>;
export type SerializedThreadRunProjectsForm = Assert<Exact<typeof serializedThreadRunSchema.Type, SerializedThreadRun>>;

export const threadEntryPayloadSchema = Schema.NullOr(Schema.Struct({ entry: threadEntryWireSchema }));

export const threadPagePayloadSchema = Schema.Struct({
  entries: Schema.Array(threadEntryWireSchema),
  before: Schema.NullOr(Schema.Int),
});

export type ThreadPagePayloadProjectsForm = Assert<Exact<typeof threadPagePayloadSchema.Type, ThreadPagePayload>>;

export const threadEventDeltaSchema = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThan(0)),
  kind: Schema.String,
  entry: Schema.optional(threadEntryWireSchema),
  withdrawn: Schema.optional(Schema.Struct({ runId: Schema.String })),
  rewound: Schema.optional(Schema.Struct({ id: Schema.String, scope: threadRewindScopeSchema, runIds: Schema.Array(Schema.String) })),
  restored: Schema.optional(Schema.Struct({ rewindId: Schema.String, runIds: Schema.Array(Schema.String) })),
});

const ordinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const feedPositionSchema = Schema.Struct({ position: ordinal, seq: ordinal, epoch: Schema.optionalKey(ordinal) });

export const threadLiveProgressSchema = Schema.Struct({
  phase: Schema.NullOr(AgentPhase),
  estimate: Schema.NullOr(Schema.Struct({ stepNumber: Schema.Number, tokens: Schema.Number, contextWindow: Schema.NullOr(Schema.Number) })),
});

const openFrom = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const threadOpenEntryValue = Schema.Struct({ entry: threadEntryWireSchema, from: openFrom });

export const threadOpenEntrySchema = Schema.Union([
  threadOpenEntryValue,
  threadEntryWireSchema.pipe(
    Schema.decodeTo(Schema.toType(threadOpenEntryValue), {
      decode: SchemaGetter.transform((entry: ThreadTranscriptEntry) => ({ entry, from: 0 })),
      encode: SchemaGetter.forbiddenEncoding,
    }),
  ),
]);

export const threadOpenTextSchema = Schema.Struct({ text: Schema.String, from: openFrom, length: openFrom });

export const threadOpenChangeSchema = Schema.Union([
  Schema.Struct({
    op: Schema.tag('put'),
    entry: threadEntryWireSchema,
    from: openFrom.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  }),
  Schema.Struct({ op: Schema.tag('append'), id: Schema.String, text: Schema.String }),
  Schema.Struct({ op: Schema.tag('drop'), id: Schema.String }),
  Schema.Struct({ op: Schema.tag('progress'), progress: Schema.NullOr(threadLiveProgressSchema) }),
]).pipe(Schema.toTaggedUnion('op'));

export function threadFeedEventSchema<const State extends Schema.Struct.Fields>(state: State) {
  const open = Schema.Array(threadOpenEntrySchema);
  const progress = Schema.NullOr(threadLiveProgressSchema);
  const records = Schema.Array(threadEventDeltaSchema);
  return Schema.Union([
    Schema.Struct({
      type: Schema.tag('snapshot'),
      at: feedPositionSchema,
      payload: Schema.Struct({
        status: Schema.tag('loaded'),
        snapshot: Schema.Struct({
          ...state,
          transcript: Schema.Array(threadEntryWireSchema),
          before: Schema.NullOr(Schema.Int),
          open,
          progress,
        }),
      }),
    }),
    Schema.Struct({
      type: Schema.tag('resume'),
      at: feedPositionSchema,
      payload: Schema.Struct({ from: feedPositionSchema, records, open, progress, snapshot: Schema.Struct(state) }),
    }),
    Schema.Struct({
      type: Schema.tag('state'),
      at: feedPositionSchema,
      payload: Schema.Struct({ records, snapshot: Schema.Struct(state) }),
    }),
    Schema.Struct({ type: Schema.tag('open'), at: feedPositionSchema, change: threadOpenChangeSchema }),
  ]).pipe(Schema.toTaggedUnion('type'));
}

export const threadStateViewFields = {
  thread: serializedThreadSchema,
  activeRun: Schema.NullOr(serializedThreadRunSchema),
  latestRun: Schema.NullOr(serializedThreadRunSchema),
  pendingInput: threadPendingInputSchema,
  status: runStatusSchema,
  now: isoString,
};

export const decodeThreadFeedEvent: (value: unknown) => ThreadFeedEvent<ThreadStateView> = Schema.decodeUnknownSync(
  threadFeedEventSchema(threadStateViewFields),
);

export function serializeThread(row: SerializedThreadSource): SerializedThread {
  const { pendingInteraction: _pendingInteraction, cacheGroup: _cacheGroup, bindings: _bindings, ...metadata } = row;
  return {
    ...metadata,
    agentId: agentTypeId(row.agentId, row.profile?.id ?? null, row.transport.agent),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeRun(row: ThreadRunRow): SerializedThreadRun {
  const {
    approvalMode: _approvalMode,
    interactive: _interactive,
    settledNotifiedAt: _settledNotifiedAt,
    streamTail: _streamTail,
    resumes: _resumes,
    cost: _cost,
    ...publicRun
  } = row;
  return {
    ...publicRun,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt.toISOString(),
    heartbeatAt: row.heartbeatAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
