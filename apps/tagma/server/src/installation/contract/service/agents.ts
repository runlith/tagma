import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export class MachineAgents extends Context.Service<
  MachineAgents,
  {
    readonly working: Effect.Effect<number, StoreFailure>;
  }
>()('tagma/installation/MachineAgents') {}
