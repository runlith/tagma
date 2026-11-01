import type { ThreadEventRevision, ThreadEventRow, ThreadRecordWindow } from '@runlith/agent/thread/storage/eventLog';
import { Context, type Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoredFailure } from '../../../platform/store/crossing.js';
import type { Unit } from '../../../platform/contract/service/units.js';

export type SourceFrontier = {
  readonly bytes: number;
  readonly position: number;
  readonly fingerprint: string;
  readonly factFingerprint: string;
};

export type SourceOrigin = 'offload' | 'export' | 'form' | 'repair' | 'adopted';

export type PublishedSource = SourceFrontier & { readonly generation: string; readonly form: string | null; readonly origin: SourceOrigin };

export type TranscriptKey = { readonly bytes: number; readonly position: number };

export type RolloutFiles = { readonly path: string; readonly packed: string; readonly transcript: string };

export type RolloutBoundary = { readonly kind: 'staged' } | { readonly kind: 'published'; readonly source: PublishedSource };

export type RestedRollout = RolloutFiles & { readonly key: TranscriptKey; readonly source: PublishedSource };

export type RolloutRange = { readonly rows: readonly ThreadEventRow[]; readonly through: number };

export class RestedRollouts extends Context.Service<
  RestedRollouts,
  {
    facet(
      threadId: string,
      tx?: Unit<'machine'>,
    ): Effect.Effect<{ readonly journal: number; readonly evicted: boolean } | null, StoredFailure>;
    restedRollout(threadId: string, tx?: Unit<'machine'>): Effect.Effect<RestedRollout | null, StoredFailure>;
    readable(threadId: string): Effect.Effect<void, StoredFailure>;
    reading<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadStorageFailed, R>;
    retaining<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadStorageFailed, R>;
    ranging<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadStorageFailed, R>;
    events(
      threadId: string,
      window: ThreadRecordWindow,
      tx?: Unit<'machine'>,
    ): Effect.Effect<readonly ThreadEventRow[] | null, StoredFailure>;
    range(threadId: string, window: ThreadRecordWindow, tx?: Unit<'machine'>): Effect.Effect<RolloutRange | null, StoredFailure>;
    revisions(
      threadId: string,
      window: ThreadRecordWindow,
      tx?: Unit<'machine'>,
    ): Effect.Effect<readonly ThreadEventRevision[] | null, StoredFailure>;
    position(threadId: string, recordId: string, tx?: Unit<'machine'>): Effect.Effect<number | null, StoredFailure>;
    head(threadId: string, tx?: Unit<'machine'>): Effect.Effect<number | null, StoredFailure>;
    rested(threadId: string, tx?: Unit<'machine'>): Effect.Effect<boolean, StoredFailure>;
  }
>()('tagma/threads/RestedRollouts') {}
