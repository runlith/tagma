import type { ThreadContextAsk } from '@runlith/agent/thread/run/ThreadRunContexts';
import type { ThreadContextUse } from '@runlith/agent/thread/agents/ThreadAgent';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { TargetAt } from '../../../workspace/contract/wire/place.js';
import type { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import type { ThreadWorld, WorldAcquisition, WorldUnavailable } from '../../../executions/contract/service/worlds.js';
import type { GraphOrigin, TargetSnapshot } from '../wire/target.js';

export type TargetThread = { readonly id: string; readonly projectId: number; readonly root?: string };

export type TargetFailure = StoreFailure | GateRefusal | WorldUnavailable;

export type WorldAcquire = (input: { readonly at: TargetAt; readonly root: string }) => Effect.Effect<WorldAcquisition, WorldUnavailable>;

export type AdmittedTarget = {
  readonly target: TargetSnapshot;
  readonly world: ThreadWorld;
};

export type TargetChange = {
  readonly thread: TargetThread;
  readonly runId: string;
  readonly fromGeneration: WorkspaceGeneration;
  readonly requestId: string;
};

export type TargetStanding = {
  readonly root: string;
  readonly graph: GraphOrigin;
};

export type PreparedTarget = {
  readonly target: TargetSnapshot;
  readonly ask: ThreadContextAsk<WriteUnit<'machine'>>;
  readonly world: ThreadWorld;
};

export class TargetPreparation extends Context.Service<
  TargetPreparation,
  {
    of(thread: TargetThread, use: ThreadContextUse, acquire: WorldAcquire): Effect.Effect<AdmittedTarget, TargetFailure>;
    prepare(change: TargetChange, acquire: WorldAcquire): Effect.Effect<PreparedTarget, TargetFailure>;
    standing(thread: TargetThread): Effect.Effect<TargetStanding, StoreFailure | GateRefusal>;
  }
>()('tagma/threads/TargetPreparation') {}
