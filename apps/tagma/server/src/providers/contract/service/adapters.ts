import { Context, type Effect, type Scope } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { AdapterState } from '../wire/catalog.js';

export type AdapterInstallRefusal = 'adapter-install' | 'unknown-adapter';

export class AdapterInstalls extends Context.Service<
  AdapterInstalls,
  {
    install(source: string): Effect.Effect<AdapterState, GateRefusal<AdapterInstallRefusal>>;
    update(id: string): Effect.Effect<AdapterState, GateRefusal<AdapterInstallRefusal>>;
    remove(id: string): Effect.Effect<void, GateRefusal<AdapterInstallRefusal>>;
    disable(id: string): Effect.Effect<AdapterState, GateRefusal<AdapterInstallRefusal>>;
    enable(id: string): Effect.Effect<AdapterState, GateRefusal<AdapterInstallRefusal>>;
    hold(directory: string | null, recorded?: boolean): Effect.Effect<boolean, never, Scope.Scope>;
  }
>()('tagma/providers/AdapterInstalls') {}

export class PackageHolders extends Context.Service<
  PackageHolders,
  {
    standing(): ReadonlySet<string>;
    readonly recorded: Effect.Effect<ReadonlySet<string>, StoreFailure>;
  }
>()('tagma/providers/PackageHolders') {}
