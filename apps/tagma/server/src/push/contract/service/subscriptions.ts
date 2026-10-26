import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Subscription } from '../wire/push.js';

export type PushStatus = {
  readonly key: string | null;
  readonly endpoint: string | null;
  readonly problem: string | null;
  readonly devices: readonly string[];
};

export class Subscriptions extends Context.Service<
  Subscriptions,
  {
    status(device: string | null): Effect.Effect<PushStatus, StoreFailure>;
    subscribe(
      device: string,
      subscription: Subscription,
    ): Effect.Effect<void, GateRefusal<'push-unavailable' | 'bad-subscription'> | StoreFailure>;
    unsubscribe(device: string): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/push/Subscriptions') {}
