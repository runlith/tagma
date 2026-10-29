import { AgentPhase } from '@runlith/agent/AgentPhase';
import { runLifeSchema, serializedThreadRunSchema } from '@runlith/agent/protocol/http';
import { runHaltSchema } from '@runlith/agent/thread/persisted';
import { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import type { RunHalt, RunLife } from '@runlith/agent/transcript/live';
import type { ThreadRunStatus } from '@runlith/agent/thread/rows';
import { Schema } from 'effect';
import { ThreadHeld } from '../../../change-record/contract/wire/holdings.js';
import { harnessRowSchema, type HarnessRowDetail } from './harness/externalSession.js';
import { harnessNameSchema, type HarnessName } from './harness/names.js';
import { transportCapabilitiesSchema, type TransportCapabilities } from '@runlith/agent/thread/record';
import { recapLineSchema, type RecapLine } from './recap.js';
import { TITLE_PROVENANCES } from '../../../thread-record/contract/wire/title.js';
import { threadFolderSchema } from '../../../thread-record/contract/wire/folder.js';

export const runEndingSchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(['completed', 'failed', 'aborted', 'cut', 'withdrawn']),
  failureReason: Schema.NullOr(Schema.String),
  failure: serializedThreadRunSchema.fields.failure,
  hostStateFailure: Schema.Boolean,
  finishedAt: Schema.String,
  isSeen: Schema.Boolean,
});

export const threadPhaseSchema = Schema.Struct({
  phase: AgentPhase.fields.phase,
  since: Schema.NullOr(AgentPhase.fields.since),
  waiting: AgentPhase.fields.waiting,
  calls: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.NullOr(Schema.String), since: Schema.NullOr(Schema.Number) })),
  queued: Schema.Number,
});
export type ThreadPhase = typeof threadPhaseSchema.Type;

export const threadSelectionSchema = Schema.Struct({
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
});

export const threadAskOptionSchema = Schema.Struct({
  label: Schema.String,
  answers: Schema.Array(Schema.Struct({ questionId: Schema.String, values: Schema.Array(Schema.String) })),
});
export type ThreadAskOption = typeof threadAskOptionSchema.Type;

export const threadAskSchema = Schema.Struct({
  questionId: Schema.String,
  text: Schema.String,
  kind: Schema.Literals(['confirm', 'question']),
  key: Schema.String,
  askedAt: Schema.NullOr(Schema.String),
  options: Schema.Array(threadAskOptionSchema),
  approver: Schema.optional(Schema.String),
  header: Schema.optional(Schema.String),
  deliveryUnknown: Schema.optional(Schema.Boolean),
  deliveryNote: Schema.optional(Schema.String),
});
export type ThreadAsk = typeof threadAskSchema.Type;

export const SAID_LINE_CHARS = 160;

export const threadContextTokensSchema = Schema.Struct({ used: Schema.Number, limit: ThreadContextLimit });
export type ThreadContextTokens = typeof threadContextTokensSchema.Type;

export type ThreadListRow = {
  readonly id: string;
  readonly projectId: number;
  readonly scopeName: string | null;
  readonly title: string;
  readonly titleOrigin: (typeof TITLE_PROVENANCES)[number];
  readonly life: RunLife;
  readonly owes?: true;
  readonly halt?: RunHalt;
  readonly activeRunId: string | null;
  readonly activeRunStartedAt: string | null;
  readonly activeRunSelection: typeof threadSelectionSchema.Type | null;
  readonly contextShare: number | null;
  readonly contextTokens?: ThreadContextTokens | null;
  readonly ask?: ThreadAsk | null;
  readonly saidLine?: string | null;
  readonly recap?: RecapLine;
  readonly cacheWarmth: typeof ThreadCacheWarmth.Type | null;
  readonly liveSpellStartedAt: string | null;
  readonly outcome: typeof runEndingSchema.Type | null;
  readonly spawnRootId: string;
  readonly parentThreadId: string | null;
  readonly detachedFrom?: string | null;
  readonly bornOf?: string | null;
  readonly name: string | null;
  readonly agentId: string;
  readonly profileId: string | null;
  readonly harness: HarnessRowDetail | null;
  readonly cli: HarnessName | null;
  readonly capabilities: TransportCapabilities;
  readonly phase: ThreadPhase | null;
  readonly held: ThreadHeld;
  readonly launchBlocked?: true;
  readonly account: string | null;
  readonly processAccount: string | null;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: Readonly<Record<string, string>>;
  readonly createdBySessionId: number | null;
  readonly readerOrderAt: string;
  readonly pinnedAt: string | null;
  readonly folderId?: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

const threadListRowFields = {
  id: Schema.String,
  projectId: Schema.Number,
  scopeName: Schema.NullOr(Schema.String),
  title: Schema.String,
  titleOrigin: Schema.Literals(TITLE_PROVENANCES),
  life: runLifeSchema,
  owes: Schema.optional(Schema.Literal(true)),
  halt: Schema.optional(runHaltSchema),
  activeRunId: Schema.NullOr(Schema.String),
  activeRunStartedAt: Schema.NullOr(Schema.String),
  activeRunSelection: Schema.NullOr(threadSelectionSchema),
  contextShare: Schema.NullOr(Schema.Number),
  contextTokens: Schema.optionalKey(Schema.NullOr(threadContextTokensSchema)),
  ask: Schema.optionalKey(Schema.NullOr(threadAskSchema)),
  saidLine: Schema.optionalKey(Schema.NullOr(Schema.String)),
  recap: Schema.optional(recapLineSchema),
  cacheWarmth: Schema.NullOr(ThreadCacheWarmth),
  liveSpellStartedAt: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(runEndingSchema),
  spawnRootId: Schema.String,
  parentThreadId: Schema.NullOr(Schema.String),
  detachedFrom: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bornOf: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.NullOr(Schema.String),
  agentId: Schema.String,
  profileId: Schema.NullOr(Schema.String),
  harness: Schema.NullOr(harnessRowSchema),
  cli: Schema.NullOr(harnessNameSchema),
  capabilities: transportCapabilitiesSchema,
  phase: Schema.NullOr(threadPhaseSchema),
  held: ThreadHeld,
  launchBlocked: Schema.optional(Schema.Literal(true)),
  account: Schema.NullOr(Schema.String),
  processAccount: Schema.NullOr(Schema.String),
  provider: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  switches: Schema.Record(Schema.String, Schema.String),
  createdBySessionId: Schema.NullOr(Schema.Number),
  readerOrderAt: Schema.String,
  pinnedAt: Schema.NullOr(Schema.String),
  folderId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
};
export interface ThreadListRowSchema extends Schema.Struct<typeof threadListRowFields> {}
export const threadListRowSchema: ThreadListRowSchema = Schema.Struct(threadListRowFields) satisfies Schema.Schema<ThreadListRow>;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type ThreadOutcomeStatusMatches = Assert<Exact<typeof runEndingSchema.Type.status, Exclude<ThreadRunStatus, 'running'>>>;

export const LIST_WINDOW_ROWS = 50;

const threadListPageFields = {
  rows: Schema.Array(threadListRowSchema),
  total: Schema.Number,
  before: Schema.NullOr(Schema.String),
};
export interface ThreadListPageSchema extends Schema.Struct<typeof threadListPageFields> {}
export const threadListPageSchema: ThreadListPageSchema = Schema.Struct(threadListPageFields);
export type ThreadListPage = typeof threadListPageSchema.Type;

const threadListWindowFields = {
  rows: Schema.Array(threadListRowSchema),
  roots: Schema.Number,
  windowBefore: Schema.NullOr(Schema.String),
};
export interface ThreadListWindowSchema extends Schema.Struct<typeof threadListWindowFields> {}
export const threadListWindowSchema: ThreadListWindowSchema = Schema.Struct(threadListWindowFields);
export type ThreadListWindow = typeof threadListWindowSchema.Type;

export const threadsFeedEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.tag('list'),
    ...threadListWindowSchema.fields,
    folders: Schema.optional(Schema.Array(threadFolderSchema)),
  }),
  Schema.Struct({ type: Schema.tag('row'), row: threadListRowSchema }),
  Schema.Struct({ type: Schema.tag('removed'), threadId: Schema.String }),
  Schema.Struct({ type: Schema.tag('folders'), folders: Schema.Array(threadFolderSchema) }),
]).pipe(Schema.toTaggedUnion('type'));
export type ThreadsFeedEvent = typeof threadsFeedEventSchema.Type;
