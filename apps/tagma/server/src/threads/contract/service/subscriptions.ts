import { Context, type Effect } from 'effect';
import type { WakingThreadEvent } from '@runlith/agent/contracts';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type ThreadSubscription = {
  readonly subscriberId: string;
  readonly targetId: string;
  readonly wakes: readonly WakingThreadEvent[];
  readonly createdAt: Date;
};

export class ThreadSubscriptions extends Context.Service<
  ThreadSubscriptions,
  {
    subscribe(
      subscriberId: string,
      targets: readonly string[],
      wakes?: readonly WakingThreadEvent[],
    ): Effect.Effect<readonly ThreadSubscription[], StoreFailure>;
    unsubscribe(subscriberId: string, targets: readonly string[]): Effect.Effect<readonly string[], StoreFailure>;
    of(subscriberId: string): Effect.Effect<readonly ThreadSubscription[], StoreFailure>;
    subscribersOf(targetId: string): Effect.Effect<readonly ThreadSubscription[], StoreFailure>;
  }
>()('tagma/threads/ThreadSubscriptions') {}
