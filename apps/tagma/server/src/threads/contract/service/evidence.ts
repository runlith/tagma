import { Context, type Effect } from 'effect';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadNotification } from '@runlith/agent/thread/storage/settlement';
import type { ActivityWindow } from '@runlith/activity/store/record';
import type { ThreadQuery, ThreadQueryCoverage, ThreadQueryGroup, ThreadQueryRow } from '@runlith/agent/thread/ThreadQuery';
import type { ThreadEventRecord } from '@runlith/agent/thread/events';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadQueryStop, ThreadSessionShape } from '@runlith/agent/thread/ThreadIntrospection';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadOpenView, ThreadResumeOf } from '@runlith/agent/transcript/live';
import type { ThreadPagePayload } from '@runlith/agent/protocol/http';
import type { ConversationHeld } from '../wire/conversation.js';
import type { EvidenceThread } from '../wire/evidence.js';
import type { StatusRowOnTheWire } from '../wire/statuses.js';
import type { EndingRowOnTheWire } from '../wire/endings.js';
import type { WarmthBasis, WarmthSubject } from '../wire/warmth.js';
import type { NativeThreadSnapshot, NativeThreadState } from './state.js';
import type { ExternalSession } from '../wire/harness/externalSession.js';
import type { HarnessFailure } from './failure.js';
import type { ThreadSelectionQuery } from '../wire/selection.js';
import type { ThreadCompositionReading, ThreadHeld } from '../wire/snapshot.js';
import type { ThreadSelection } from '../../list/select.js';
import type { RunStatus } from '@runlith/agent/transcript/live';
import type { ThreadListProjection, ThreadSummary } from '../../list/summary.js';

export type EvidenceReader = { readonly kind: 'thread'; readonly threadId: string } | { readonly kind: 'operator' };

export type EvidenceStop = ThreadQueryStop;

export type EvidenceQuery =
  | { readonly kind: 'query'; readonly query: ThreadQuery }
  | { readonly kind: 'list'; readonly selection: ThreadSelectionQuery };

export type EvidencePinnedThread = {
  readonly threadId: string;
  readonly facts?: {
    readonly head: number;
    readonly runs: readonly ThreadQueryRow[];
  };
};

export type EvidenceListing = { readonly reading: string; readonly total: number; readonly project: number };

export type EvidencePin = {
  readonly id: string;
  readonly asks: EvidenceQuery;
  readonly threads: readonly EvidencePinnedThread[];
  readonly pinnedAt: string;
  readonly selection?: string;
  readonly named?: string;
  readonly listing?: EvidenceListing;
  readonly activity?: { readonly project: number; readonly window?: ActivityWindow; readonly members?: true };
};

export type PinnedEvidence = {
  readonly rows?: readonly ThreadQueryRow[];
  readonly groups?: readonly ThreadQueryGroup[];
  readonly coverage: ThreadQueryCoverage;
  readonly walk?: EvidenceStop;
};

export type EvidenceQuestion = { readonly asks: EvidenceQuery; readonly threads: readonly string[]; readonly selection?: string };

export type ThreadActSummary = {
  readonly name: string | null;
  readonly entries: number;
  readonly blocks: readonly string[];
  readonly bounded: boolean;
};

export type ThreadRunActs = {
  readonly acts: readonly { readonly op: string; readonly block: string | null; readonly at: string }[];
  readonly bounded: boolean;
};

export type ThreadEvidenceSnapshot = {
  readonly shape: Omit<ThreadSessionShape, 'runs'> & {
    readonly runs: readonly (ThreadRunRow & { readonly notification: ThreadNotification | null })[];
  };
  readonly facet: {
    readonly title: string;
    readonly projectId: number;
    readonly scope: string | null;
    readonly harness: ExternalSession | null;
  };
  readonly acts: ThreadActSummary;
};

export type EvidenceContinuation = { readonly cursor: string };

export type ResolvedEvidenceInput = PinnedEvidenceQuery | EvidenceContinuation;

export type PinnedEvidenceQuery = {
  readonly query: ThreadQuery;
  readonly threads: readonly string[];
  readonly selection?: ThreadSelection;
  readonly cursor?: string;
};

export type EvidenceQueryAnswer = {
  readonly select: ThreadQuery['select'];
  readonly threads: readonly EvidenceThread[];
  readonly over: number;
  readonly rows: readonly ThreadQueryRow[];
  readonly groups?: readonly ThreadQueryGroup[];
  readonly coverage: ThreadQueryCoverage;
  readonly cursor: string | null;
};

export type ListingRequest = {
  readonly asked: ThreadSelectionQuery;
  readonly selection: ThreadSelection;
  readonly limit: number;
  readonly cursor?: string;
};

export type ThreadListAnswer = {
  readonly rows: readonly ThreadListProjection[];
  readonly total: number;
  readonly cursor: string | null;
  readonly set: ThreadSelection['view'];
};

export type PresenceSource =
  | { readonly threadId: string; readonly outcome: 'found'; readonly summary: ThreadSummary; readonly status: RunStatus }
  | { readonly threadId: string; readonly outcome: 'not-found' | 'foreign-project' };

export type EvidenceAddress = { readonly threadId: string; readonly at: string | number };

export type ExpandedEvidenceRecord =
  | {
      readonly threadId: string;
      readonly at: string | number;
      readonly record: ThreadEventRecord;
      readonly origin: 'own' | 'inherited' | 'unknown';
    }
  | { readonly threadId: string; readonly at: string | number; readonly fact: ThreadQueryRow }
  | { readonly threadId: string; readonly at: string | number; readonly missing: string }
  | { readonly threadId: string; readonly at: string | number; readonly unread: string }
  | { readonly threadId: string; readonly at: string | number; readonly output: ToolOutputPage };

export type ToolOutputPage = { readonly text: string; readonly from: number; readonly bytes: number; readonly next: number | null };

export type ExpandInput = {
  readonly addresses: readonly EvidenceAddress[];
  readonly envelopeBytes: number;
  readonly around?: number;
  readonly fields?: readonly string[];
  readonly outputFrom?: number;
  readonly body?: number;
};

export class ThreadEvidence extends Context.Service<
  ThreadEvidence,
  {
    snapshot(threadId: string, projectId: number): Effect.Effect<NativeThreadSnapshot, HarnessFailure>;
    statuses(threadIds: readonly string[], projectId: number): Effect.Effect<readonly StatusRowOnTheWire[], HarnessFailure>;
    endings(threadIds: readonly string[], projectId: number, depth: number): Effect.Effect<readonly EndingRowOnTheWire[], HarnessFailure>;
    presence(threadIds: readonly string[], projectId: number): Effect.Effect<readonly PresenceSource[], HarnessFailure>;
    presenceOne(threadId: string, projectId: number): Effect.Effect<PresenceSource, HarnessFailure>;
    shape(threadId: string, projectId: number): Effect.Effect<ThreadEvidenceSnapshot, HarnessFailure>;
    composition(threadId: string, projectId: number): Effect.Effect<ThreadCompositionReading, HarnessFailure>;
    held(threadId: string, projectId: number): Effect.Effect<ThreadHeld, HarnessFailure>;
    entry(threadId: string, projectId: number, entryId: string): Effect.Effect<{ entry: ThreadTranscriptEntry } | null, HarnessFailure>;
    entries(threadId: string, projectId: number, before: number): Effect.Effect<ThreadPagePayload, HarnessFailure>;
    attachFrom(
      threadId: string,
      projectId: number,
      sincePosition: number,
    ): Effect.Effect<ThreadResumeOf<NativeThreadState> | null, HarnessFailure>;
    rewindActs(threadId: string, projectId: number, runIds: readonly string[]): Effect.Effect<ThreadRunActs, HarnessFailure>;
  }
>()('tagma/threads/ThreadEvidence') {}

export class EvidenceQueries extends Context.Service<
  EvidenceQueries,
  {
    resolve(reader: EvidenceReader, projectId: number, request: ResolvedEvidenceInput): Effect.Effect<PinnedEvidenceQuery, HarnessFailure>;
    list(reader: EvidenceReader, projectId: number, request: ListingRequest): Effect.Effect<ThreadListAnswer, HarnessFailure>;
    query(reader: EvidenceReader, projectId: number, request: PinnedEvidenceQuery): Effect.Effect<EvidenceQueryAnswer, HarnessFailure>;
    expand(projectId: number, input: ExpandInput): Effect.Effect<readonly ExpandedEvidenceRecord[], HarnessFailure>;
  }
>()('tagma/threads/EvidenceQueries') {}

export class EvidenceFeed extends Context.Service<
  EvidenceFeed,
  {
    subscribe(threadId: string, listener: (event: ThreadLiveEvent<NativeThreadState>) => void): () => void;
    view(threadId: string): ThreadOpenView;
  }
>()('tagma/threads/EvidenceFeed') {}

export class CacheWarmth extends Context.Service<
  CacheWarmth,
  {
    cacheCurves(): Effect.Effect<WarmthBasis['curves'], HarnessFailure>;
    warmthBasis(threads: readonly WarmthSubject[]): Effect.Effect<WarmthBasis, HarnessFailure>;
  }
>()('tagma/threads/CacheWarmth') {}

export class EvidenceReads extends Context.Service<
  EvidenceReads,
  {
    pin(reader: EvidenceReader, pin: Omit<EvidencePin, 'id' | 'pinnedAt'>): Effect.Effect<EvidencePin, HarnessFailure>;
    retain(reader: EvidenceReader, pin: EvidencePin, result: PinnedEvidence): Effect.Effect<void, HarnessFailure>;
    held(reader: EvidenceReader, pin: EvidencePin): Effect.Effect<PinnedEvidence | null, HarnessFailure>;
    cursor(reader: EvidenceReader, pin: EvidencePin, stop: EvidenceStop | null): string | null;
    resume(
      reader: EvidenceReader,
      cursor: string,
      question?: EvidenceQuestion,
    ): Effect.Effect<{ pin: EvidencePin; from: EvidenceStop }, HarnessFailure>;
    release(threadId: string): Effect.Effect<void, HarnessFailure>;
    holdSearch(reader: EvidenceReader, held: ConversationHeld, cursor: string | null): Effect.Effect<string, HarnessFailure>;
    heldSearch(reader: EvidenceReader, cursor: string): Effect.Effect<ConversationHeld, HarnessFailure>;
  }
>()('tagma/threads/EvidenceReads') {}
