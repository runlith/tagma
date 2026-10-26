import { Context, type Effect } from 'effect';
import type { ThreadBirthCarried, ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadInsertValues } from '@runlith/agent/thread/storage/aggregate';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { ModelPreference } from '../wire/birth.js';
import type { HarnessSeat } from '../wire/harness/seat.js';
import type { HarnessFailure } from './failure.js';

export class BirthFactWriting extends Context.Service<BirthFactWriting, BirthFacts>()('tagma/threads/BirthFactWriting') {}

export class BirthModelSelection extends Context.Service<BirthModelSelection, BirthModels>()('tagma/threads/BirthModelSelection') {}

export class ThreadHistoryReads extends Context.Service<ThreadHistoryReads, ThreadHistories>()('tagma/threads/ThreadHistoryReads') {}

export class HarnessBirthRows extends Context.Service<HarnessBirthRows, RowBirths>()('tagma/threads/HarnessBirthRows') {}

export type RowBirths = {
  readonly transaction: <T, E>(work: (unit: WriteUnit<'machine'>) => Effect.Effect<T, E>) => Effect.Effect<T, E | ThreadStorageFailed>;
  readonly find: (id: string, unit?: Unit<'machine'>) => Effect.Effect<ThreadRow | undefined, ThreadStorageFailed>;
  readonly findNamed: (
    spawnRootId: string,
    ownerId: string,
    name: string,
    unit?: Unit<'machine'>,
  ) => Effect.Effect<ThreadRow | undefined, ThreadStorageFailed>;
  readonly insert: (values: ThreadInsertValues, unit: WriteUnit<'machine'>) => Effect.Effect<ThreadRow, ThreadStorageFailed>;
  readonly insertChild: (
    parentThreadId: string,
    values: Omit<ThreadInsertValues, 'parentThreadId'>,
    unit: WriteUnit<'machine'>,
  ) => Effect.Effect<ThreadRow, ThreadPortFailure>;
  readonly attachFacet: (
    input: {
      readonly threadId: string;
      readonly projectId: number;
      readonly name?: string;
      readonly createdBySessionId?: number | null;
      readonly harness?: HarnessSeat;
    },
    unit: WriteUnit<'machine'>,
  ) => Effect.Effect<unknown, StoreFailure | ThreadPortFailure>;
  readonly inheritFacet: (
    input: {
      readonly threadId: string;
      readonly fromThreadId: string;
      readonly contextFrom?: string;
      readonly agentId: string;
      readonly harness?: HarnessSeat | null;
      readonly carried?: ThreadBirthCarried;
      readonly isRoot?: boolean;
      readonly title?: string;
      readonly projectId?: number;
    },
    unit: WriteUnit<'machine'>,
  ) => Effect.Effect<number | undefined, StoreFailure>;
};

export type BirthFacts = {
  readonly attach: (
    input: {
      readonly threadId: string;
      readonly projectId: number;
      readonly scopeBlockUuid?: string;
      readonly title?: string;
      readonly name?: string;
      readonly createdBySessionId?: number | null;
      readonly harness?: HarnessSeat;
      readonly delegation?: boolean;
      readonly team?: TeamLayer;
    },
    tx: WriteUnit<'machine'>,
  ) => Effect.Effect<ThreadRow, StoreFailure | ThreadPortFailure>;
};

export type BirthModels = {
  readonly selection: (input: {
    readonly profile?: AgentProfile;
    readonly account?: string;
    readonly switches?: ModelSwitches;
  }) => Effect.Effect<ModelPreference, HarnessFailure>;
  readonly switches: (input: {
    readonly provider: string;
    readonly model: string | null;
    readonly switches?: ModelSwitches;
  }) => Effect.Effect<ModelSwitches, HarnessFailure>;
};

export type ThreadHistories = {
  readonly of: (threadId: string) => Effect.Effect<ThreadRow['history'] | null, ThreadPortFailure>;
};
