import { Context, type Effect, Schema } from 'effect';
import type { ThreadMetadataRow, ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadSummary } from '../../list/summary.js';

export type ThreadMetadataReads = {
  metadata(id: string, tx?: Unit<'machine'>): Effect.Effect<ThreadMetadataRow | undefined, ThreadStorageFailed>;
};

export const ThreadAncestry = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    parent: Schema.NullOr(Schema.String),
    home: Schema.NullOr(Schema.Number),
    principal: Schema.String,
    archived: Schema.NullOr(Schema.Number),
    spell: Schema.NullOr(Schema.Number),
  }),
);
export type ThreadAncestry = typeof ThreadAncestry.Type;

type ThreadLatestRun = {
  readonly runId: string;
  readonly status: ThreadRunRow['status'];
  readonly pingId: string | null;
  readonly pingAt: Date | null;
};

export type ThreadActivity = {
  readonly threadId: string;
  readonly projectId: number | null;
  readonly parentThreadId: string | null;
  readonly rootId: string | null;
  readonly runId: string;
};

type ThreadWaiting = {
  readonly parentThreadId: string | null;
  readonly waits: boolean;
  readonly owing: boolean;
};

export type ThreadLineage = {
  readonly threadId: string;
  readonly home: number | null;
  readonly parentThreadId: string | null;
  readonly principal: string | null;
  readonly ancestry: ThreadAncestry;
};

export type ThreadRowChange = { readonly summary: ThreadSummary; readonly observed: boolean };

export type ThreadRowRemoved = { readonly threadId: string; readonly projectId: number | null; readonly parentThreadId: string | null };

export type ThreadRowBatch = {
  readonly rows: readonly ThreadRowChange[];
  readonly removed: readonly ThreadRowRemoved[];
  readonly activity: boolean;
  readonly reset: boolean;
};

export type ThreadRetainer = {
  readonly wants: (place: ThreadLineage) => boolean;
  readonly keeps: (summary: ThreadSummary) => boolean;
};

export class ThreadRows extends Context.Service<
  ThreadRows,
  {
    readonly current: (id: string) => ThreadSummary | undefined;
    readonly latest: (id: string) => ThreadLatestRun | null;
    readonly read: (ids: readonly string[]) => Effect.Effect<readonly ThreadSummary[], StoreFailure | ThreadStorageFailed>;
    readonly readIn: (
      unit: Unit<'machine'>,
      ids: readonly string[],
    ) => Effect.Effect<readonly ThreadSummary[], StoreFailure | ThreadStorageFailed>;
    readonly retain: (retainer: ThreadRetainer) => () => void;
    readonly release: (ids: readonly string[]) => void;
    readonly subscribe: (listener: (batch: ThreadRowBatch) => void) => () => void;
    readonly activities: () => ReadonlyMap<string, ThreadActivity>;
    readonly waiting: (id: string) => ThreadWaiting | null;
    readonly waitingIds: () => readonly string[];
    readonly owing: (ids?: readonly string[]) => Effect.Effect<readonly string[]>;
  }
>()('tagma/threads/ThreadRows') {}
