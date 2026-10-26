import { Context, type Effect } from 'effect';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import type { ServedGraph } from '../../../graph/contract/service/serving.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphStore, MachineStore } from '../../../platform/contract/service/store.js';
import type { GraphOrigin } from '../../../threads/contract/wire/target.js';

export class ThreadGraphs extends Context.Service<
  ThreadGraphs,
  {
    readonly graph: Context.Context<GraphServices | GraphStore | MachineStore>;
    readonly graphFor: (projectId: number) => Effect.Effect<Context.Context<GraphServices | GraphStore>, GateRefusal>;
    readonly graphAt: (origin: GraphOrigin) => Effect.Effect<ServedGraph, GateRefusal>;
  }
>()('tagma/native-harness/ThreadGraphs') {}
