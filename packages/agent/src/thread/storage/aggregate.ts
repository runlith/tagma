import { Data, type Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadBindings } from '../../agent/contracts';
import type { ThreadEntryPlacement } from '../../transcript/eventFold';
import type { ThreadBornOf } from '../../protocol/birth';
import type { ThreadTranscriptPage } from '../../transcript/rows';
import type { ThreadDefinition, ThreadProfileBirth } from '../agents/AgentProfile';
import type {
  ThreadAuthority,
  ThreadContextReading,
  ThreadHistory,
  ThreadMetadataRow,
  ThreadPendingInteraction,
  ThreadPromptState,
  ThreadRow,
  ThreadStatus,
} from '../rows';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadCacheObservationValues } from './cacheObservations';
import type { TransportBinding } from '../record';
import type { TransportCapabilities } from '../record';
import { coreEntry } from '../../transcript/kinds';

type ThreadWritableColumns = {
  spawnedByRunId?: string | null;
  authority?: ThreadAuthority;
  budgetTokens?: number | null;
  hostKind?: string | null;
  hostId?: string | null;
  pendingInteraction?: ThreadPendingInteraction;
  account?: string | null;
  provider?: ThreadRow['provider'];
  model?: string | null;
  reasoning?: string | null;
  switches?: ModelSwitches;
  transport?: TransportBinding;
  capabilities?: TransportCapabilities;
  systemPrompt?: string | null;
  pendingSystemPrompt?: string | null;
  profile?: ThreadProfileBirth | null;
  agentId?: string;
  pendingDefinition?: ThreadDefinition | null;
  status?: ThreadStatus;
  failureReason?: string | null;
  createdBy?: string | null;
};

export type ThreadInsertValues = ThreadWritableColumns & {
  ownerId: string;
  agentId: string;
  id?: string;
  cacheGroup?: string;
  name?: string | null;
  authority?: ThreadAuthority;
  plain?: boolean;
  bindings?: ThreadBindings;
  bornOf?: ThreadBornOf | null;
  parentThreadId?: string | null;
  history?: ThreadHistory;
  transcript?: ThreadTranscript;
};

export type ThreadTeamPosition = { readonly movedAt: Date; readonly id: string };

export type ThreadTeamAsk = {
  readonly spawnRootId: string;
  readonly ownerId: string;
  readonly parent?: string;
  readonly within: 'running' | 'resting';
  readonly after?: ThreadTeamPosition;
  readonly limit: number;
};

export type ThreadTeamPage = {
  readonly rows: readonly ThreadMetadataRow[];
  readonly total: number;
};

export type ThreadPatch = ThreadWritableColumns & {
  parentThreadId?: string | null;
};

export type ThreadFoldSpan = {
  readonly from: number;
  readonly through: number;
};

export type ThreadAtomicPatch = ThreadPatch & {
  history?: ThreadHistory;
  covered?: ThreadFoldSpan | null;
  placements?: readonly ThreadEntryPlacement[];
  contextReading?: ThreadContextReading | null;
  cacheObservations?: readonly ThreadCacheObservationValues[];
};

export type ThreadTranscriptQuery = {
  readonly before?: number;
  readonly limit: number;
  readonly bytes: number;
};

export class ThreadNotFoundError extends Data.TaggedError('ThreadNotFound')<{ readonly message: string; readonly threadId: string }> {
  constructor(threadId: string) {
    super({ message: `Thread not found: ${threadId}.`, threadId });
    this.name = 'ThreadNotFoundError';
  }
}

export type ThreadDeleteBlocker = { readonly kind: 'run' | 'child'; readonly id: string };

export class ThreadDeleteConflictError extends Data.TaggedError('ThreadDeleteConflict')<{
  readonly message: string;
  readonly threadId: string;
  readonly blockedBy: ThreadDeleteBlocker;
}> {
  constructor(input: { threadId: string; blockedBy: ThreadDeleteBlocker }) {
    super({
      message: `Thread ${input.threadId} could not be deleted: ${input.blockedBy.kind} ${input.blockedBy.id} arrived while it was being cleared.`,
      threadId: input.threadId,
      blockedBy: input.blockedBy,
    });
    this.name = 'ThreadDeleteConflictError';
  }
}

export class ThreadDeleteStillSettlingError extends Data.TaggedError('ThreadDeleteStillSettling')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string | null;
}> {
  constructor(threadId: string, runId: string | null) {
    super({
      message:
        runId === null
          ? `Thread ${threadId} could not be deleted because its activity record was still writing.`
          : `Thread ${threadId} could not be deleted because run ${runId} was still settling.`,
      threadId,
      runId,
    });
    this.name = 'ThreadDeleteStillSettlingError';
  }
}

export interface ThreadAggregateStorage<TTx, TWrite extends TTx = TTx> {
  transaction<T, E>(work: (tx: TWrite) => Effect.Effect<T, E>): Effect.Effect<T, E | ThreadPortFailure>;
  program?<T, E>(identity: string, work: (tx: TWrite) => Effect.Effect<T, E>): Effect.Effect<T | null, E | ThreadPortFailure>;

  find(id: string, tx?: TTx): Effect.Effect<ThreadRow | undefined, ThreadPortFailure>;
  findOwned(id: string, ownerId: string, tx?: TTx): Effect.Effect<ThreadRow | undefined, ThreadPortFailure>;

  metadata(id: string, tx?: TTx): Effect.Effect<ThreadMetadataRow | undefined, ThreadPortFailure>;
  metadataOf(ids: readonly string[], tx?: TTx): Effect.Effect<readonly ThreadMetadataRow[], ThreadPortFailure>;

  systemPromptOf(id: string, tx?: TTx): Effect.Effect<ThreadPromptState | undefined, ThreadPortFailure>;

  logs(id: string, tx?: TTx): Effect.Effect<{ history: ThreadHistory; transcript: ThreadTranscript } | null, ThreadPortFailure>;

  transcriptOf(id: string, tx?: TTx): Effect.Effect<ThreadTranscript | null, ThreadPortFailure>;

  historyOf(id: string, tx?: TTx): Effect.Effect<ThreadHistory | null, ThreadPortFailure>;

  entriesOfRun(id: string, runId: string, tx?: TTx): Effect.Effect<ThreadTranscript, ThreadPortFailure>;
  entryById(id: string, entryId: string, tx?: TTx): Effect.Effect<ThreadTranscriptEntry | undefined, ThreadPortFailure>;
  questionById(id: string, questionId: string, tx?: TTx): Effect.Effect<ThreadQuestionEntry | undefined, ThreadPortFailure>;
  openQuestionsOfRun(id: string, runId: string, tx?: TTx): Effect.Effect<readonly ThreadQuestionEntry[], ThreadPortFailure>;

  transcriptWindow(id: string, query: ThreadTranscriptQuery, tx?: TTx): Effect.Effect<ThreadTranscriptPage | null, ThreadPortFailure>;

  insert(values: ThreadInsertValues, tx?: TWrite): Effect.Effect<ThreadRow, ThreadPortFailure>;

  insertChild(
    parentThreadId: string,
    values: Omit<ThreadInsertValues, 'parentThreadId'>,
    tx: TWrite,
  ): Effect.Effect<ThreadRow, ThreadPortFailure>;

  update(id: string, patch: ThreadPatch, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  appendEntries(id: string, input: { history?: ThreadHistory; transcript?: ThreadTranscript }): Effect.Effect<void, ThreadPortFailure>;

  branch(seed: ThreadBranchSeed, tx: TWrite): Effect.Effect<ThreadBranchBase, ThreadPortFailure>;

  delete(ids: readonly string[], tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  pageTeam(ask: ThreadTeamAsk, tx?: TTx): Effect.Effect<ThreadTeamPage, ThreadPortFailure>;

  findNamed(spawnRootId: string, ownerId: string, name: string, tx?: TTx): Effect.Effect<ThreadRow | undefined, ThreadPortFailure>;

  listByHost(ownerId: string, hostKind: string, hostId: string, tx?: TTx): Effect.Effect<readonly ThreadMetadataRow[], ThreadPortFailure>;
  listByParent(ownerId: string, parentThreadId: string, tx?: TTx): Effect.Effect<readonly ThreadMetadataRow[], ThreadPortFailure>;
  listSubtree(ownerId: string, threadId: string): Effect.Effect<readonly ThreadMetadataRow[], ThreadPortFailure>;
  holdSubtree(ownerId: string, threadId: string, tx: TWrite): Effect.Effect<readonly ThreadMetadataRow[], ThreadPortFailure>;
}

export type ThreadBranchEntries =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'turns'; readonly turns: number }
  | { readonly kind: 'kept'; readonly taken: readonly string[] };

export type ThreadBranchSeed = {
  readonly sourceId: string;
  readonly childId: string;
  readonly entries: ThreadBranchEntries;
  readonly prompts: 'kept' | 'dropped';
};

export type ThreadBranchBase = { readonly through: number; readonly from: string | null };

export function branchedTranscript(
  transcript: ThreadTranscript,
  entries: ThreadBranchEntries,
  prompts: ThreadBranchSeed['prompts'],
  sealed: ThreadTranscript = [],
): ThreadTranscript {
  const carried = carriedEntries(transcript, entries).filter((entry) => prompts === 'kept' || entry.type !== 'system-prompt');
  if (sealed.length === 0) return carried;
  const replaced = new Map(sealed.map((entry) => [entry.id, entry]));
  return carried.map((entry) => replaced.get(entry.id) ?? entry);
}

export function branchedFrom(transcript: ThreadTranscript, entries: ThreadBranchEntries): string | null {
  if (entries.kind !== 'turns') return null;
  const carried = carriedEntries(transcript, entries);
  return carried.length === transcript.length ? null : (carried[0]?.id ?? null);
}

function carriedEntries(transcript: ThreadTranscript, entries: ThreadBranchEntries): ThreadTranscript {
  switch (entries.kind) {
    case 'all':
      return transcript;
    case 'none':
      return [];
    case 'turns': {
      const reader: number[] = [];
      transcript.forEach((entry: ThreadTranscriptEntry, index: number) => {
        if (coreEntry(entry) && (entry.type === 'signal' || (entry.type === 'message' && entry.role === 'user'))) reader.push(index);
      });
      return transcript.slice(reader.length <= entries.turns ? 0 : (reader[reader.length - entries.turns] ?? 0));
    }
    case 'kept': {
      const taken = new Set(entries.taken);
      return transcript.filter(
        (entry) =>
          entry.type === 'system-prompt' || (entry.rewound === undefined && !(entry.runId !== undefined && taken.has(entry.runId))),
      );
    }
  }
}
