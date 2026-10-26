import type { Effect, Scope } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SyncRefusal } from '../../tree/commits.js';
import type { GraphRemainder } from '../wire/answers.js';
import type { GraphCommitPolicy } from '../../settings.js';

export type TreeDelivered = 'delivered' | 'ordinary';

export type TreeSynced =
  | 'ordinary'
  | { readonly head: string | null; readonly policy: GraphCommitPolicy; readonly left: GraphRemainder | undefined };

export type TreeSync = (
  projectId: number,
  checkout: string,
) => Effect.Effect<TreeSynced, GateRefusal<SyncRefusal | OpenRefusal> | StoreFailure>;

export type TreeDelivery = (
  projectId: number,
  checkout: string,
) => Effect.Effect<TreeDelivered, GateRefusal<SyncRefusal | OpenRefusal> | StoreFailure>;

export type TreeReady = (
  projectId: number,
  checkout: string,
) => Effect.Effect<void, GateRefusal<SyncRefusal | OpenRefusal> | StoreFailure, Scope.Scope>;

export type GraphDelivery = { readonly ready: TreeReady; readonly sync: TreeSync; readonly deliver: TreeDelivery };
