import type { ThreadEventRevision, ThreadEventRow, ThreadRecordWindow } from '@runlith/agent/thread/storage/eventLog';
import { Context, type Effect } from 'effect';
import type { StoredFailure } from '../../../platform/store/crossing.js';
import type { Unit } from '../../../platform/contract/service/units.js';

export type TranscriptKey = { readonly bytes: number; readonly position: number };

export type RolloutFiles = { readonly path: string; readonly packed: string; readonly transcript: string };

export type RestedRollout = RolloutFiles & { readonly key: TranscriptKey };

export type RolloutRange = { readonly rows: readonly ThreadEventRow[]; readonly through: number };

export class RestedRollouts extends Context.Service<
  RestedRollouts,
  {
    facet(
      threadId: string,
      tx?: Unit<'machine'>,
    ): Effect.Effect<{ readonly projectId: number; readonly evicted: boolean } | null, StoredFailure>;
    restedRollout(threadId: string, tx?: Unit<'machine'>): Effect.Effect<RestedRollout | null, StoredFailure>;
    readable(threadId: string): Effect.Effect<void, StoredFailure>;
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
