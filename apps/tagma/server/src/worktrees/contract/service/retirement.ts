import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { WorktreeDeleted } from '../wire/retirement.js';
import type { FinishFailure, WorktreeFinishRefused } from '../wire/failures.js';
import type { GraphDelivery } from '../../../graph/contract/service/delivery.js';
import type { FinishingPlace } from '../wire/mergeTypes.js';

export class WorktreeRetirement extends Context.Service<
  WorktreeRetirement,
  {
    delete(projectId: number, rootId: RootId, end?: TerminalActor): Effect.Effect<WorktreeDeleted, FinishFailure>;
    place(
      projectId: number,
      rootId: RootId,
      withBase: boolean,
    ): Effect.Effect<{ readonly folder: string; readonly base: string | null }, FinishFailure>;
    terms(projectId: number, rootId: RootId, asking: string | null): Effect.Effect<FinishingPlace, FinishFailure>;
  }
>()('tagma/worktrees/WorktreeRetirement') {}

export class RetirementSettlement extends Context.Service<
  RetirementSettlement,
  {
    readonly writes: WriteSet;
    dropPendingMerge(rootId: RootId, unit: WriteUnit<'machine'>): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/worktrees/RetirementSettlement') {}

export class GraphDelivering extends Context.Service<GraphDelivering, GraphDelivery>()('tagma/worktrees/GraphDelivering') {}

export class WorktreeDeparture extends Context.Service<
  WorktreeDeparture,
  { readonly departed: (projectId: number) => Effect.Effect<void> }
>()('tagma/worktrees/WorktreeDeparture') {}

export type GateKey = { readonly kind: 'root'; readonly rootId: RootId } | { readonly kind: 'checkout'; readonly path: string };

export class FinishingGate extends Context.Service<
  FinishingGate,
  {
    hold<A, E, R>(key: GateKey, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | WorktreeFinishRefused, R>;
  }
>()('tagma/worktrees/FinishingGate') {}
