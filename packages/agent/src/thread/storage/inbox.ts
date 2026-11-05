import { Data, type Effect, Schema } from 'effect';
import { AgentSignalNotice } from '../../agent/contracts';
import { ThreadCompactionEntry } from '../../transcript/entries';
import type { Keyed, TransitionOutcome } from '../keyed';
import type { ThreadReadFailure } from '../record';
import type { ThreadStorageFailed } from '../persisted';
import type { ThreadPortFailure } from '../ThreadBorder';

export const THREAD_INBOX_KINDS = ['turn', 'task', 'envelope', 'signal', 'compaction'] as const;
export type ThreadInboxKind = (typeof THREAD_INBOX_KINDS)[number];

export const THREAD_COMPACTION_POINTS = ['step', 'end'] as const;
export type ThreadCompactionPoint = (typeof THREAD_COMPACTION_POINTS)[number];

export const THREAD_INBOX_STATES = ['queued', 'delivered', 'acknowledged'] as const;
export type ThreadInboxState = (typeof THREAD_INBOX_STATES)[number];

export const THREAD_WORD_FATES = ['read', 'returned', 'unconfirmed', 'withdrawn', 'acknowledged'] as const;
export type ThreadWordFate = (typeof THREAD_WORD_FATES)[number];

export const threadInputAcceptanceSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('confirmed') }),
  Schema.Struct({ status: Schema.Literal('unconfirmed'), reason: Schema.String }),
]);
export type ThreadInputAcceptance = typeof threadInputAcceptanceSchema.Type;

export const threadInboxSenderSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('reader') }),
  Schema.Struct({
    kind: Schema.Literal('thread'),
    threadId: Schema.String,
    name: Schema.NullOr(Schema.String),
    projectId: Schema.optional(Schema.Number),
    asOperator: Schema.optional(Schema.Literal(true)),
  }),
  Schema.Struct({ kind: Schema.Literal('host') }),
]);
export type ThreadInboxSender = typeof threadInboxSenderSchema.Type;

export const THREAD_INBOX_REQUEST_INTENTS = ['task', 'interrupt'] as const;
export type ThreadInboxRequestIntent = (typeof THREAD_INBOX_REQUEST_INTENTS)[number];

export const THREAD_INBOX_ENVELOPE_INTENTS = ['message', 'report', 'approval'] as const;
export type ThreadInboxEnvelopeIntent = (typeof THREAD_INBOX_ENVELOPE_INTENTS)[number];

const threadInboxAttachmentRefSchema = Schema.Struct({ id: Schema.String });

export const threadInboxTurnBodySchema = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(threadInboxAttachmentRefSchema)),
});
export const reportDeliverySchema = Schema.Literals(['turn', 'collect']);
export type ReportDelivery = typeof reportDeliverySchema.Type;

export const threadInboxTaskBodySchema = Schema.Struct({
  intent: Schema.Literals(THREAD_INBOX_REQUEST_INTENTS),
  reportDelivery: Schema.optional(reportDeliverySchema),
  text: Schema.String,
  inReplyTo: Schema.NullOr(Schema.String),
});
export const threadEnvelopeContextSchema = Schema.Struct({
  tokens: Schema.Number,
  warmUntil: Schema.optional(Schema.String),
});

export const threadInboxEnvelopeBodySchema = Schema.Struct({
  intent: Schema.Literals(THREAD_INBOX_ENVELOPE_INTENTS),
  text: Schema.String,
  inReplyTo: Schema.NullOr(Schema.String),
  context: Schema.optional(threadEnvelopeContextSchema),
});
export const threadInboxSignalBodySchema = Schema.Struct({
  type: Schema.String,
  addressee: Schema.Literals(['reader', 'transport']),
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(threadInboxAttachmentRefSchema)),
  notice: Schema.optional(AgentSignalNotice),
  waits: Schema.optional(Schema.Literal(true)),
});
export const threadSummarizerSelectionSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
});

export const threadInboxCompactionBodySchema = Schema.Struct({
  at: Schema.Literals(THREAD_COMPACTION_POINTS),
  mode: Schema.optional(ThreadCompactionEntry.fields.mode),
  keep: Schema.optional(Schema.String),
  summarizer: Schema.optional(threadSummarizerSelectionSchema),
});
export const threadInboxBodySchema = Schema.Union([
  threadInboxTurnBodySchema,
  threadInboxTaskBodySchema,
  threadInboxEnvelopeBodySchema,
  threadInboxSignalBodySchema,
  threadInboxCompactionBodySchema,
]);
export type ThreadInboxBody = typeof threadInboxBodySchema.Type;

const itemFields = {
  id: Schema.String,
  threadId: Schema.String,
  sender: threadInboxSenderSchema,
  state: Schema.Literals(THREAD_INBOX_STATES),
  deliveredToRunId: Schema.NullOr(Schema.String),
  occurredAt: Schema.String,
};

export const threadInboxItemSchema = Schema.Union([
  Schema.Struct({ ...itemFields, kind: Schema.Literal('turn'), body: threadInboxTurnBodySchema }),
  Schema.Struct({ ...itemFields, kind: Schema.Literal('task'), body: threadInboxTaskBodySchema }),
  Schema.Struct({ ...itemFields, kind: Schema.Literal('envelope'), body: threadInboxEnvelopeBodySchema }),
  Schema.Struct({ ...itemFields, kind: Schema.Literal('signal'), body: threadInboxSignalBodySchema }),
  Schema.Struct({ ...itemFields, kind: Schema.Literal('compaction'), body: threadInboxCompactionBodySchema }),
]);
export type ThreadInboxItem = typeof threadInboxItemSchema.Type;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ThreadInboxItemValues = DistributiveOmit<ThreadInboxItem, 'state' | 'deliveredToRunId'>;

export type ThreadInboxRequest = Extract<ThreadInboxItem, { kind: 'task' }>;

export const THREAD_REQUEST_REQUESTER_GONE = 'requester-gone';
export const THREAD_REQUEST_MIGRATED = 'migrated';
export const THREAD_REQUEST_DETACHED = 'detached';

export type ThreadInboxRow = {
  id: string;
  threadId: string;
  sender: ThreadInboxSender;
  kind: ThreadInboxKind;
  body: ThreadInboxBody;
  state: ThreadInboxState;
  deliveredToRunId: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type InboxArrivals = {
  readonly items: readonly ThreadInboxItem[];
  readonly through: number;
};

export type InboxArrivalQuery = {
  readonly threadId: string;
  readonly after: number | null;
  readonly reports?: 'all';
};

export interface ThreadInboxStorage<TTx, TWrite extends TTx = TTx> {
  put(values: ThreadInboxItemValues, tx?: TWrite): Effect.Effect<{ item: ThreadInboxItem; fresh: boolean }, ThreadPortFailure>;

  deliver(ids: readonly string[], runId: string, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  acknowledge(ids: readonly string[], runId: string | null, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  returnTo(runId: string, tx?: TWrite): Effect.Effect<readonly string[], ThreadPortFailure>;

  fated(threadId: string, runId: string, ids: readonly string[], fate: ThreadWordFate, tx: TWrite): Effect.Effect<void, ThreadPortFailure>;

  pending(threadId: string, tx?: TTx): Effect.Effect<readonly ThreadInboxItem[], ThreadPortFailure>;
  pendingOf(threadIds: readonly string[], tx?: TTx): Effect.Effect<ReadonlyMap<string, readonly ThreadInboxItem[]>, ThreadPortFailure>;

  arrivals(input: InboxArrivalQuery, tx?: TTx): Effect.Effect<InboxArrivals, ThreadPortFailure>;

  delivered(threadId: string, runId: string, tx?: TTx): Effect.Effect<readonly string[], ThreadPortFailure>;

  unconfirmed(threadId: string, runId: string, tx?: TTx): Effect.Effect<readonly string[], ThreadPortFailure>;

  receipt(id: string, tx?: TTx): Effect.Effect<ThreadInboxItem | undefined, ThreadPortFailure>;

  intendWake(ids: readonly string[], tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  pendingWakes(limit: number, tx?: TTx): Effect.Effect<readonly ThreadInboxItem[], ThreadPortFailure>;

  woke(ids: readonly string[], tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  openRequests(threadId: string, tx?: TTx): Effect.Effect<readonly ThreadInboxRequest[], ThreadPortFailure>;

  openRequestsUnder(idPrefixes: readonly string[], tx?: TTx): Effect.Effect<readonly ThreadInboxRequest[], ThreadPortFailure>;

  closeRequests(ids: readonly string[], by: string, tx?: TWrite): Effect.Effect<readonly string[], ThreadPortFailure>;

  control<A>(
    threadId: string,
    plan: InboxPlan<A>,
    call: { readonly key: Keyed; readonly deadline: Date },
  ): Effect.Effect<TransitionOutcome<A>, InboxFailure>;
}

export type InboxRequestState = {
  readonly request: ThreadInboxRequest;
  readonly state: 'open' | 'taken' | 'closed';
  readonly takenBy: string | null;
};

export type InboxView = {
  request(requestId: string): Effect.Effect<InboxRequestState | null, ThreadStorageFailed>;
  item(itemId: string): Effect.Effect<ThreadInboxItem | null, ThreadStorageFailed>;
  newestTaken(threadId: string, requesterThreadId: string): Effect.Effect<ThreadInboxRequest | null, ThreadStorageFailed>;
};

export type InboxWrites = {
  put(values: ThreadInboxItemValues): Effect.Effect<{ readonly item: ThreadInboxItem; readonly fresh: boolean }, ThreadStorageFailed>;
  acknowledge(itemIds: readonly string[], runId: string | null): Effect.Effect<void, ThreadStorageFailed>;
  closeRequests(requestIds: readonly string[], by: string): Effect.Effect<readonly string[], ThreadStorageFailed>;
  intendWake(itemIds: readonly string[]): Effect.Effect<void, ThreadStorageFailed>;
};

export type InboxPlan<A> = {
  decide(
    view: InboxView,
  ): Effect.Effect<
    { readonly apply: (writes: InboxWrites) => Effect.Effect<void, ThreadStorageFailed>; readonly result: A } | { readonly refuse: A },
    ThreadReadFailure
  >;
};

export class InboxConflict extends Data.TaggedError('InboxConflict')<{
  readonly threadId: string;
  readonly reason: 'act-id-reused';
  readonly key: Keyed;
}> {}

export type InboxFailure = InboxConflict | ThreadReadFailure;
