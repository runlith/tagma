import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
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
  }
>()('tagma/providers/AdapterInstalls') {}
