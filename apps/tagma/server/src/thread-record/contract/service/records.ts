import type { ThreadBornOf } from '@runlith/agent/protocol/birth';
import type { ThreadStatus } from '@runlith/agent/thread/rows';
import { Context, Effect } from 'effect';
import type { Raised } from '@runlith/agent/permissions';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { StoredFailure } from '../../../platform/store/crossing.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { ThreadRecordFacts, ThreadRelation } from '../wire/record.js';
import type { ThreadRecap } from '../wire/recap.js';
import type { ThreadTitle, TitleNaming, TitleProvenance } from '../wire/title.js';
import type { HomeMove } from './homes.js';

export type RecordAddress = { readonly threadId: ThreadId; readonly projectId: number };

export type AddressFrom = { readonly threadId: string | null; readonly projectId: number | null };

export type TitleRecorded = { readonly threadId: ThreadId; readonly revision: number };

export type StatusPublished = {
  readonly threadId: ThreadId;
  readonly status: ThreadStatus;
  readonly runningRunId: string | null;
  readonly fromRunId: string | null;
};

export type ShelfRecorded = { readonly threadIds: readonly ThreadId[] };

export type RecordBirth = {
  readonly id: string;
  readonly projectId?: number | null;
  readonly parentId?: string | null;
  readonly spawnRootId: string;
  readonly detachedFrom?: string | null;
  readonly detachedAt?: Date | null;
  readonly principalId: string;
  readonly name?: string | null;
  readonly title?: string;
  readonly titleOrigin?: TitleProvenance;
  readonly titleRevision?: number;
  readonly titleAskedInput?: string | null;
  readonly harness?: string;
  readonly agentId: string;
  readonly bornOf?: ThreadBornOf | null;
  readonly spawnedByRunId?: string | null;
  readonly createdBy?: string | null;
  readonly scopeBlockUuid?: string | null;
  readonly createdBySessionId?: number | null;
  readonly readerOrderAt?: Date;
  readonly pinnedAt?: Date | null;
  readonly archivedAt?: Date | null;
  readonly status?: ThreadStatus;
  readonly movedAt?: Date | null;
  readonly recap?: ThreadRecap | null;
  readonly createdAt?: Date;
};

export type RecordScope = {
  readonly projectId: number | null;
  readonly scopeBlockUuid?: string | null;
  readonly createdBySessionId?: number | null;
  readonly archivedAt?: Date | null;
  readonly title: string;
  readonly titleOrigin: TitleProvenance;
  readonly harness?: string;
};

export type RecordHarness = { readonly harness: string; readonly agentId: string };

export type ThreadStatusMove = {
  readonly status?: ThreadStatus;
  readonly run?: { readonly to: string | null; readonly expected?: string | null };
  readonly movedAt?: Date;
};

export type Detached = {
  readonly status: 'detached';
  readonly from: ThreadId;
  readonly subtree: readonly ThreadId[];
  readonly team: readonly ThreadId[];
  readonly formerRootPinned: boolean;
};

export type DetachRefused = { readonly status: 'not-a-child'; readonly detachedFrom: ThreadId | null; readonly detachedAt: Date | null };

export type Reattached = {
  readonly status: 'reattached';
  readonly under: ThreadId;
  readonly detachedAt: Date;
  readonly subtree: readonly ThreadId[];
};

export type ReattachRefused =
  | { readonly status: 'not-detached' }
  | { readonly status: 'parent-archived'; readonly parent: ThreadId }
  | { readonly status: 'name-taken'; readonly name: string; readonly holder: ThreadId };

export class ThreadRecords extends Context.Service<
  ThreadRecords,
  {
    readonly writes: WriteSet;
    facts(id: string, unit?: Unit<'machine'>): Effect.Effect<ThreadRecordFacts | undefined, StoredFailure>;
    projectOf(id: string, unit?: Unit<'machine'>): Effect.Effect<number | undefined, StoreFailure>;
    address(address: string, from: AddressFrom): Effect.Effect<RecordAddress | null, StoreFailure>;
    projectsOf(ids: readonly string[]): Effect.Effect<ReadonlyMap<string, number | null>, StoreFailure>;
    countIn(projectId: number): Effect.Effect<number, StoreFailure>;
    namesIn(projectId: number, unit: Unit<'machine'>): Effect.Effect<ReadonlySet<string>, StoreFailure>;
    isDescendant(id: string, ancestorId: string, unit?: Unit<'machine'>): Effect.Effect<boolean, StoreFailure>;
    relation(id: string, callerId: string): Effect.Effect<ThreadRelation, StoreFailure>;
    subtree(id: string, unit?: Unit<'machine'>, excludingLineage?: string | null): Effect.Effect<readonly ThreadId[], StoreFailure>;
    insert(unit: WriteUnit<'machine'>, birth: RecordBirth): Effect.Effect<void, StoreFailure>;
    scope(unit: WriteUnit<'machine'>, id: string, facts: RecordScope): Effect.Effect<boolean, StoreFailure>;
    harnessed(unit: WriteUnit<'machine'>, id: string, served: RecordHarness): Effect.Effect<boolean, StoreFailure>;
    remove(unit: WriteUnit<'machine'>, ids: readonly string[]): Effect.Effect<void, StoreFailure>;
    publishStatus(unit: WriteUnit<'machine'>, id: string, move: ThreadStatusMove): Effect.Effect<boolean, StoreFailure>;
    setArchived(unit: WriteUnit<'machine'>, ids: readonly string[], at: Date | null): Effect.Effect<readonly ThreadId[], StoreFailure>;
    setPinned(unit: WriteUnit<'machine'>, id: string, at: Date | null): Effect.Effect<ThreadId | undefined, StoreFailure>;
    detach(unit: WriteUnit<'machine'>, id: string, at: Date): Effect.Effect<Detached | DetachRefused, StoreFailure>;
    reattach(unit: WriteUnit<'machine'>, id: string): Effect.Effect<Reattached | ReattachRefused, StoreFailure>;
    advanceReaderOrder(unit: WriteUnit<'machine'>, id: string, at: Date): Effect.Effect<void, StoreFailure>;
    rehome(unit: WriteUnit<'machine'>, move: HomeMove, at: Date): Effect.Effect<boolean, StoreFailure>;
    setTitle(unit: WriteUnit<'machine'>, id: string, title: string, provenance: TitleProvenance): Effect.Effect<void, StoreFailure>;
    nameTitle(unit: WriteUnit<'machine'>, id: string, title: string, expectedRevision: number): Effect.Effect<TitleNaming, StoreFailure>;
    adoptTitle(
      unit: WriteUnit<'machine'>,
      id: string,
      title: string,
      expectedRevision: number,
      provenances: readonly TitleProvenance[],
    ): Effect.Effect<boolean, StoreFailure>;
    claimTitleInput(unit: WriteUnit<'machine'>, id: string, input: string): Effect.Effect<ThreadTitle | undefined, StoreFailure>;
    writeRecap(unit: WriteUnit<'machine'>, id: string, recap: ThreadRecap): Effect.Effect<boolean, StoreFailure>;
    voidRecap(unit: WriteUnit<'machine'>, id: string, appearedAt: number): Effect.Effect<boolean, StoreFailure>;
    birthRecorded(subscriber: (event: RecordAddress) => Effect.Effect<void>): () => void;
    removalRecorded(subscriber: (event: RecordAddress) => Effect.Effect<void>): () => void;
    titleRecorded(subscriber: (event: TitleRecorded) => Effect.Effect<void>): () => void;
    statusPublished(subscriber: (event: StatusPublished) => Effect.Effect<void>): () => void;
    shelfRecorded(subscriber: (event: ShelfRecorded) => Effect.Effect<void>): () => void;
  }
>()('tagma/thread-record/ThreadRecords') {}

export const strangerRaised = Effect.fnUntraced(function* (
  threadId: string,
  asking: string | null,
  act: string,
): Effect.fn.Return<readonly Raised[], StoreFailure, ThreadRecords> {
  if (asking === null || asking === threadId) return [];
  const relation = yield* (yield* ThreadRecords).relation(threadId, asking);
  return relation === 'subtree'
    ? []
    : [{ condition: 'outside-subtree', fact: `${threadId} stands outside the calling thread's subtree; ${act}` }];
});
