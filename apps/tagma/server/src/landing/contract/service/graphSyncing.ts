import { Context, type Effect, type Scope } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GraphSync } from '../wire/merge.js';

export class GraphSyncing extends Context.Service<GraphSyncing, (projectId: number, checkout: string) => Effect.Effect<GraphSync>>()(
  'tagma/landing/GraphSyncing',
) {}

export type GraphCarried = (projectId: number) => Effect.Effect<boolean, StoreFailure>;

export type GraphSettled = (projectId: number, checkout: string) => Effect.Effect<void, GateRefusal>;

export type GraphHeld = (projectId: number, checkout: string) => Effect.Effect<void, GateRefusal, Scope.Scope>;
