import { Context, type Effect, type Scope } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RegistryIncoherent } from '../wire/registry.js';

export class MachineRegistry extends Context.Service<
  MachineRegistry,
  {
    readonly dump: Effect.Effect<void, StoreFailure | RegistryIncoherent>;
    watch(changed: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  }
>()('tagma/installation/MachineRegistry') {}
