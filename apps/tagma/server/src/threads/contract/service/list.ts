import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { Context, type Effect } from 'effect';
import type { Actor } from '../../../platform/contract/wire/actor.js';
import type { FieldRefusal } from '../../../platform/contract/wire/refusal.js';
import type { THREAD_OPERATIONS } from '../wire/operations/catalog.js';
import type { ThreadArchiveSweep } from '../wire/sweep.js';
import type { HarnessFailure } from './failure.js';
import type { ThreadCursor, ThreadSelection } from '../../list/select.js';
import type { ThreadListProjection, ThreadSummary } from '../../list/summary.js';
import type { ThreadFolder } from '../../../thread-record/contract/wire/folder.js';
import type { ThreadRelation } from '../../../thread-record/contract/wire/record.js';

type SessionCode<K extends keyof typeof THREAD_OPERATIONS> = (typeof THREAD_OPERATIONS)[K]['refusals'][number] | FieldRefusal;

export type ThreadProjectionPage = {
  readonly rows: readonly ThreadListProjection[];
  readonly total: number;
  readonly before: ThreadCursor | null;
};

export type ThreadProjectionWindow = {
  readonly rows: readonly ThreadListProjection[];
  readonly roots: number;
  readonly windowBefore: Date | null;
};

export type ThreadsEvent =
  | {
      readonly kind: 'list';
      readonly rows: readonly ThreadListProjection[];
      readonly roots: number;
      readonly windowBefore: Date | null;
    }
  | { readonly kind: 'row'; readonly row: ThreadListProjection }
  | { readonly kind: 'removed'; readonly threadId: string }
  | { readonly kind: 'folders'; readonly folders: readonly ThreadFolder[] };

export type AttentionEvent =
  | { readonly kind: 'row'; readonly row: ThreadListProjection }
  | { readonly kind: 'removed'; readonly threadId: string }
  | { readonly kind: 'resync' };

export type OpenCalls = (threadId: string, runId: string) => Effect.Effect<readonly ThreadTranscriptEntry[], unknown>;

export type ArchiveClose = (threadIds: readonly string[]) => Effect.Effect<void, HarnessFailure>;
export type ArchiveWork = <A, E>(
  threadIds: readonly string[],
  work: (close: ArchiveClose) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | HarnessFailure>;

export class ThreadList extends Context.Service<
  ThreadList,
  {
    attention(): Effect.Effect<readonly ThreadSummary[], HarnessFailure>;
    pulse(): Effect.Effect<readonly ThreadSummary[], HarnessFailure>;
    subscribeAttention(listener: (event: AttentionEvent) => void): () => void;
    observe(threadId: string, notify: () => void): () => void;
    list(projectId: number, selection: ThreadSelection): Effect.Effect<ThreadProjectionPage, HarnessFailure<SessionCode<'list_threads'>>>;
    listWindow(projectId: number, before?: Date): Effect.Effect<ThreadProjectionWindow, HarnessFailure>;
    openWindow(projectId: number): Effect.Effect<ThreadProjectionWindow, HarnessFailure>;
    row(threadId: string): Effect.Effect<ThreadListProjection | undefined, HarnessFailure>;
    subscribe(projectId: number, listener: (event: ThreadsEvent) => void): () => void;
    announce(row: ThreadSummary): ThreadListProjection;
    announceThread(threadId: string): Effect.Effect<void>;
    announceFolders(projectId: number, folders: readonly ThreadFolder[]): void;
    resync(projectId?: number): void;
    markHeld(threadId: string): Effect.Effect<void>;
    relation(threadId: string, callerId: string): Effect.Effect<ThreadRelation, HarnessFailure>;
    working(threadId: string): Effect.Effect<readonly string[], HarnessFailure>;
    sweepRelation(
      projectId: number,
      selection: Omit<ThreadSelection, 'view'>,
      archived: boolean,
      callerId: string,
    ): Effect.Effect<ThreadRelation, HarnessFailure>;
    serveArchiving(work: ArchiveWork): () => void;
    serveOpenCalls(read: OpenCalls): () => void;
    setArchived(
      threadId: string,
      projectId: number,
      archived: boolean,
      spared?: string | null,
    ): Effect.Effect<ThreadListProjection, HarnessFailure>;
    setArchivedMatching(
      projectId: number,
      selection: Omit<ThreadSelection, 'view'>,
      archived: boolean,
      by: Actor,
    ): Effect.Effect<ThreadArchiveSweep, HarnessFailure<SessionCode<'archive_threads'>>>;
    setPinned(
      threadId: string,
      projectId: number,
      pinned: boolean,
    ): Effect.Effect<ThreadListProjection, HarnessFailure<SessionCode<'pin_thread'>>>;
    see(threadId: string, projectId: number, runId: string): Effect.Effect<ThreadListProjection, HarnessFailure>;
  }
>()('tagma/threads/ThreadList') {}
