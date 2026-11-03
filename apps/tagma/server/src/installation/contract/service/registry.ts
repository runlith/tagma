import { Context, type Effect, type Scope } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export class MachineRegistry extends Context.Service<
  MachineRegistry,
  {
    readonly dump: Effect.Effect<void, StoreFailure>;
    watch(changed: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  }
>()('tagma/installation/MachineRegistry') {}
