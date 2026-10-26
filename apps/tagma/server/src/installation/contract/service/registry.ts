import { Context, type Effect } from 'effect';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import type { MachineStore, MigrationChain, StoreFailure, StoreOpenFailure } from '../../../platform/contract/service/store.js';
import type { RegistryFile, RegistryUnreadable } from '../wire/registry.js';

export class MachineRegistry extends Context.Service<
  MachineRegistry,
  {
    dump(): Effect.Effect<void, StoreFailure, MachineStore>;
    restore(
      storePath: string,
      migrations: MigrationChain<'machine'>,
      file: RegistryFile,
      processes: ProcessPool,
    ): Effect.Effect<boolean, StoreOpenFailure>;
    open(read: RegistryFile | null): Effect.Effect<void, StoreFailure | RegistryUnreadable, MachineStore>;
  }
>()('tagma/installation/MachineRegistry') {}
