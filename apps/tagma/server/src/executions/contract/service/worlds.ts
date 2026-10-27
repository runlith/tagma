import { Context, Data, type Effect, type FileSystem, type Layer, type Scope } from 'effect';
import type { Commands, World } from '@runlith/agent-tools/world';
import type { ProvedRoot, TargetAt } from '../../../workspace/contract/wire/place.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { CheckoutWorld } from '../wire/world.js';

export type ThreadWorld = {
  readonly kind: string;
  readonly substrate?: CheckoutWorld;
  readonly facts: WorldFacts;
  readonly world: World;
  readonly root: string;
  readonly scratch: string;
  readonly alive: () => boolean;
};

export type WorldFacts = {
  readonly shared: boolean;
  readonly history: boolean;
  readonly network: boolean;
};

export const CHECKOUT_WORLD_KIND = 'checkout';
export const CHECKOUT_FACTS: WorldFacts = { shared: true, history: true, network: true };

export class WorldUnavailable extends Data.TaggedError('WorldUnavailable')<{
  readonly threadId: string;
  readonly hostKind: string | null;
  readonly reason: string;
}> {
  override get message(): string {
    return `world-unavailable: thread ${this.threadId} on ${this.hostKind ?? 'the checkout'} — ${this.reason}`;
  }
}

export type WorldThread = {
  readonly id: string;
  readonly hostKind: string | null;
  readonly hostId: string | null;
};

export type WorldHost = {
  readonly kind: string;
  world(thread: WorldThread): Effect.Effect<ThreadWorld, WorldUnavailable, Scope.Scope>;
};

export type WorldAcquisition = {
  readonly world: ThreadWorld;
  readonly place: ProvedRoot | null;
};

export type WorldRequest = {
  readonly thread: WorldThread;
  readonly at: TargetAt;
  readonly root: string;
  readonly projectId: number;
};

export type WorldLease = {
  readonly scope: Scope.Scope;
  readonly release: Effect.Effect<void>;
};

export class MachineWorld extends Context.Service<
  MachineWorld,
  {
    readonly world: World;
  }
>()('tagma/executions/MachineWorld') {}

export class WorldPreferences extends Context.Service<
  WorldPreferences,
  {
    readonly checkout: () => Effect.Effect<CheckoutWorld, StoreFailure>;
  }
>()('tagma/executions/WorldPreferences') {}

export class Worlds extends Context.Service<
  Worlds,
  {
    readonly of: (request: WorldRequest) => Effect.Effect<WorldAcquisition, WorldUnavailable>;
    readonly lease: (at: TargetAt) => Effect.Effect<WorldLease>;
    readonly release: (at: TargetAt) => Effect.Effect<void>;
    readonly releaseRun: (threadId: string, runId: string) => Effect.Effect<void>;
    readonly drop: (threadId: string) => Effect.Effect<void>;
    readonly closeAll: () => Effect.Effect<void>;
  }
>()('tagma/executions/Worlds') {}

export type LedgerKey = {
  readonly substrate: 'managed' | 'platform';
  readonly threadId: string;
  readonly projectId?: number;
};

export class CommandLedger extends Context.Service<
  CommandLedger,
  {
    readonly of: (subject: LedgerKey) => Commands;
  }
>()('tagma/executions/CommandLedger') {}

export class WorldFiles extends Context.Service<
  WorldFiles,
  {
    readonly files: Layer.Layer<FileSystem.FileSystem> | undefined;
  }
>()('tagma/executions/WorldFiles') {}
