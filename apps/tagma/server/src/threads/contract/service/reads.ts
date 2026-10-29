import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { HarnessId } from '../../../platform/contract/wire/session.js';
import type { ThreadSelection, ThreadPage, ThreadWindow, ThreadFamily, ThreadSelectionPage } from '../../list/select.js';
import type { PlacedEntry, SubtreeMember, ThreadGate, ThreadMetadata } from '../../list/store.js';
import type { ThreadListMove, ThreadSummary } from '../../list/summary.js';
import type { ArchiveWork } from './list.js';
import type { HarnessFailure } from './failure.js';

export type HeldSession = {
  readonly runId: string;
  readonly threadId: string;
  readonly kind: 'run' | 'harness';
  readonly harness: HarnessId;
};

export class ThreadLookup extends Context.Service<
  ThreadLookup,
  {
    find(id: string, ownerId: string): Effect.Effect<ThreadMetadata | undefined, StoreFailure | ThreadPortFailure>;
    summary(threadId: string): Effect.Effect<ThreadSummary | undefined, StoreFailure | ThreadStorageFailed>;
    summaries(ids: readonly string[]): Effect.Effect<readonly ThreadSummary[], StoreFailure | ThreadStorageFailed>;
    gateFacet(id: string): Effect.Effect<ThreadGate | undefined, StoreFailure>;
    subtree(threadId: string): Effect.Effect<readonly SubtreeMember[], StoreFailure>;
  }
>()('tagma/threads/ThreadLookup') {}

export class ThreadWindows extends Context.Service<
  ThreadWindows,
  {
    list(ownerId: string, projectId: number, selection: ThreadSelection): Effect.Effect<ThreadPage, HarnessFailure>;
    pin(ownerId: string, projectId: number, selection: ThreadSelection): Effect.Effect<string, HarnessFailure>;
    page(
      ownerId: string,
      projectId: number,
      reading: string,
      after: number,
      limit: number,
    ): Effect.Effect<ThreadSelectionPage, HarnessFailure>;
    attention(ownerId: string): Effect.Effect<readonly ThreadSummary[], StoreFailure | ThreadStorageFailed>;
    pulse(ownerId: string): Effect.Effect<readonly ThreadSummary[], StoreFailure | ThreadStorageFailed>;
    families(
      ownerId: string,
      member: ThreadSummary,
      projects: readonly number[],
    ): Effect.Effect<readonly ThreadFamily[], StoreFailure | ThreadStorageFailed>;
    rootWindow(
      ownerId: string,
      projectId: number,
      page: { readonly limit: number; readonly before?: Date },
    ): Effect.Effect<ThreadWindow, StoreFailure | ThreadStorageFailed>;
    heldUpMatching(
      ownerId: string,
      projectId: number,
      selection: ThreadSelection,
      spared: string | null,
    ): Effect.Effect<
      ReadonlyArray<{ threadId: string; runId: string; kind: 'run' | 'harness'; sessionThreadId: string; harness: HarnessId }>,
      StoreFailure
    >;
    selectsBeyond(ownerId: string, projectId: number, selection: ThreadSelection, callerId: string): Effect.Effect<boolean, StoreFailure>;
  }
>()('tagma/threads/ThreadWindows') {}

export class ThreadRunning extends Context.Service<
  ThreadRunning,
  {
    runningRunOf(threadId: string): Effect.Effect<string | null, StoreFailure>;
    runningRun(threadId: string, unit: Unit<'machine'>): Effect.Effect<string | null, StoreFailure>;
    activeRunInSubtree(threadId: string): Effect.Effect<{ runId: string; threadId: string } | null, StoreFailure>;
    heldSessionsInSubtree(threadId: string): Effect.Effect<readonly HeldSession[], StoreFailure>;
    heldSessionsIn(projectId: number): Effect.Effect<readonly HeldSession[], StoreFailure>;
    readonly working: Effect.Effect<number, StoreFailure>;
  }
>()('tagma/threads/ThreadRunning') {}

export class ThreadPlaces extends Context.Service<
  ThreadPlaces,
  {
    standings(projectId: number, threadIds?: readonly string[]): Effect.Effect<readonly ThreadListMove[], StoreFailure>;
    placedIn(projectId: number, rootId: string): Effect.Effect<readonly PlacedEntry[], StoreFailure>;
  }
>()('tagma/threads/ThreadPlaces') {}

export class ThreadShelving extends Context.Service<
  ThreadShelving,
  {
    setArchived(threadId: string, at: Date | null): Effect.Effect<readonly string[], StoreFailure>;
    setPinned(threadId: string, at: Date | null): Effect.Effect<string | undefined, StoreFailure>;
    setArchivedWhere(
      ownerId: string,
      projectId: number,
      selection: ThreadSelection,
      at: Date | null,
      spared: string | null,
      before?: ArchiveWork,
    ): Effect.Effect<{ moved: readonly string[]; working: readonly { threadId: string; runId: string }[] }, HarnessFailure>;
    restingProjects(): Effect.Effect<readonly number[], StoreFailure>;
    restingPast(projectId: number, before: Date): Effect.Effect<readonly string[], StoreFailure>;
  }
>()('tagma/threads/ThreadShelving') {}

export class ThreadReading extends Context.Service<
  ThreadReading,
  {
    see(threadId: string, runId: string): Effect.Effect<ThreadSummary | undefined, StoreFailure | ThreadStorageFailed>;
    advanceReaderOrder(threadId: string, at?: Date): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/threads/ThreadReading') {}
