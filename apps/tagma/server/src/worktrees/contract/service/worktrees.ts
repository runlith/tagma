import { Context, Data, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { WorktreeSetupDetail, WorktreeSetupStatus } from '../wire/rows.js';

export class WorktreeStorageFailed extends Data.TaggedError('WorktreeStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Worktree operation ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export type WorktreeStoreFailure = StoreFailure | WorktreeStorageFailed;

export type WorktreeDraft = {
  readonly rootId: RootId;
  readonly projectId: number;
  readonly name: string;
  readonly path: string;
  readonly branch: string | null;
  readonly baseBranch: string | null;
  readonly baseCommit: string;
  readonly origin: string;
};

export type WorktreeRecord = WorktreeDraft & {
  readonly hue: number;
  readonly setup: WorktreeSetupStatus;
  readonly setupDetail: WorktreeSetupDetail | null;
  readonly taskId: string | null;
  readonly createdAt: Date;
};

type Machine = Unit<'machine'>;
type Write = WriteUnit<'machine'>;

export class WorktreeRecords extends Context.Service<
  WorktreeRecords,
  {
    record(draft: WorktreeDraft, unit: Write): Effect.Effect<WorktreeRecord, StoreFailure>;
    records(projectId: number, unit: Machine): Effect.Effect<readonly WorktreeRecord[], StoreFailure>;
    recordedRoots(projectId: number, unit: Machine): Effect.Effect<readonly RootId[], StoreFailure>;
    byRoot(rootId: RootId, unit: Machine): Effect.Effect<WorktreeRecord | null, StoreFailure>;
    unsettled(unit: Machine): Effect.Effect<readonly WorktreeRecord[], StoreFailure>;
    settle(
      rootId: RootId,
      from: WorktreeSetupStatus,
      to: WorktreeSetupStatus,
      detail: WorktreeSetupDetail | null,
      unit: Write,
    ): Effect.Effect<boolean, StoreFailure>;
    drop(rootId: RootId, unit: Write): Effect.Effect<boolean, StoreFailure>;
    nameAfter(rootId: RootId, threadId: string, unit: Write): Effect.Effect<boolean, StoreFailure>;
    namedAfter(threadId: string, unit: Machine): Effect.Effect<WorktreeRecord | null, StoreFailure>;
    renamed(rootId: RootId, from: string, to: string, unit: Write, threadId?: string): Effect.Effect<boolean, StoreFailure>;
    unnamed(rootId: RootId, threadId: string, unit: Write): Effect.Effect<void, StoreFailure>;
    liveProjects(unit: Machine): Effect.Effect<readonly number[], StoreFailure>;
  }
>()('tagma/worktrees/WorktreeRecords') {}
