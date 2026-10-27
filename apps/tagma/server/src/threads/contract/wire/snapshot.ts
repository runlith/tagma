import {
  serializedThreadSchema,
  threadFeedEventSchema,
  threadEntryWireSchema,
  threadLiveProgressSchema,
  threadStateViewFields,
  type ThreadStateView,
} from '@runlith/agent/protocol/http';
import { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import type { ThreadFeedEvent, ThreadFeedSnapshot } from '@runlith/agent/transcript/live';
import { THREAD_COMPOSITION_PARTS } from '@runlith/agent/protocol/compositionParts';
import { Schema } from 'effect';
import { ApprovalModeView } from '@runlith/agent/modes/ApprovalMode';
import { harnessRowSchema, type HarnessRowDetail } from './harness/externalSession.js';
import { harnessNameSchema, type HarnessName } from './harness/names.js';
import type { ThreadSpawnDepth } from '@runlith/agent/collaboration/ThreadSpawnAccess';
import { approvingSchema, type Approving } from './approving.js';
import { delegationSchema, spawnDepthSchema, threadPlaceSchema, type Delegation, type ThreadPlace } from './birth.js';
import { recapAttemptSchema, recapReadingSchema, type RecapAttempt, type RecapReading } from './recap.js';
import { pinnedViewSchema, type PinnedView } from './pins.js';

export const threadCompositionReadingSchema = Schema.Struct({
  threadId: Schema.String,
  reading: Schema.Literals(['measured', 'estimated']),
  total: Schema.Number,
  limit: Schema.NullOr(ThreadContextLimit),
  parts: Schema.Array(
    Schema.Struct({
      id: Schema.Literals([...THREAD_COMPOSITION_PARTS]),
      count: Schema.Number,
      tokens: Schema.Number,
    }),
  ),
  tools: Schema.Array(Schema.Struct({ name: Schema.String, tokens: Schema.Number })),
  deferredTools: Schema.Array(Schema.String),
  orientation: Schema.Array(Schema.Struct({ name: Schema.String, tokens: Schema.Number })),
  cleared: Schema.Struct({ count: Schema.Number, tokens: Schema.Number }),
  ledger: Schema.Struct({
    runs: Schema.Number,
    compactions: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    cacheReadTokens: Schema.Number,
    cacheWriteTokens: Schema.Number,
    toolCalls: Schema.Array(Schema.Struct({ name: Schema.String, count: Schema.Number })),
  }),
  pruning: Schema.Struct({
    share: Schema.Number,
    protectedTokens: Schema.Number,
    liveToolOutputTokens: Schema.Number,
    nextPruneAtTokens: Schema.Number,
  }),
});
export type ThreadCompositionReading = typeof threadCompositionReadingSchema.Type;

export const threadHeldSchema = Schema.Struct({
  held: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      id: Schema.String,
      detail: Schema.String,
      heldAt: Schema.String,
    }),
  ),
});
export type ThreadHeld = typeof threadHeldSchema.Type;

export const threadParentSchema = Schema.Struct({ id: Schema.String, projectId: Schema.Int, title: Schema.String });
export type ThreadParent = typeof threadParentSchema.Type;

export type WireThread = ThreadStateView['thread'] & {
  readonly title: string;
  readonly parent?: ThreadParent;
  readonly detachedFrom?: ThreadParent;
  readonly cacheWarmth: typeof ThreadCacheWarmth.Type | null;
  readonly harness: HarnessRowDetail | null;
  readonly cli: HarnessName | null;
  readonly processAccount: string | null;
  readonly delegation: Delegation;
  readonly approving: Approving;
  readonly spawnDepth: ThreadSpawnDepth;
  readonly place: ThreadPlace | null;
  readonly recap: RecapReading | null;
  readonly recapAttempt: RecapAttempt | null;
  readonly modes: readonly ApprovalModeView[];
  readonly pins: readonly PinnedView[];
};
export type WireState = Omit<ThreadStateView, 'thread'> & { readonly thread: WireThread; readonly contextLimit: ThreadContextLimit | null };
export type WireSnapshot = ThreadFeedSnapshot<WireState>;
export type ThreadWireSnapshotPayload = { readonly status: 'loaded'; readonly snapshot: WireSnapshot };
export type ThreadWireFeedEvent = ThreadFeedEvent<WireState>;

const wireThreadSchema = Schema.Struct({
  ...serializedThreadSchema.fields,
  title: Schema.String,
  parent: Schema.optional(threadParentSchema),
  detachedFrom: Schema.optional(threadParentSchema),
  cacheWarmth: Schema.NullOr(ThreadCacheWarmth),
  harness: Schema.NullOr(harnessRowSchema),
  cli: Schema.NullOr(harnessNameSchema),
  processAccount: Schema.NullOr(Schema.String),
  delegation: delegationSchema,
  approving: approvingSchema,
  spawnDepth: spawnDepthSchema,
  place: Schema.NullOr(threadPlaceSchema),
  recap: Schema.NullOr(recapReadingSchema),
  recapAttempt: Schema.NullOr(recapAttemptSchema),
  pins: Schema.Array(pinnedViewSchema),
  modes: Schema.Array(ApprovalModeView),
}) satisfies Schema.Schema<WireThread>;

const wireStateFields = {
  ...threadStateViewFields,
  thread: wireThreadSchema,
  contextLimit: Schema.NullOr(ThreadContextLimit),
};

const threadWireSnapshotPayloadFields = {
  status: Schema.tag('loaded'),
  snapshot: Schema.Struct({
    ...wireStateFields,
    transcript: Schema.Array(threadEntryWireSchema),
    before: Schema.NullOr(Schema.Int),
    open: Schema.Array(threadEntryWireSchema),
    progress: Schema.NullOr(threadLiveProgressSchema),
  }),
};
export interface ThreadWireSnapshotPayloadSchema extends Schema.Struct<typeof threadWireSnapshotPayloadFields> {}
export const threadWireSnapshotPayloadSchema: ThreadWireSnapshotPayloadSchema = Schema.Struct(
  threadWireSnapshotPayloadFields,
) satisfies Schema.Schema<ThreadWireSnapshotPayload>;

export const threadWireFeedEventSchema = threadFeedEventSchema(wireStateFields);
