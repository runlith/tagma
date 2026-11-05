import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { PinnedView } from '../wire/pins.js';
import type { HarnessFailure } from './failure.js';
import type { ThreadInputRefused } from './failure.js';

export class ThreadPins extends Context.Service<
  ThreadPins,
  {
    read(threadId: string, unit?: Unit<'machine'>): Effect.Effect<readonly PinnedView[], StoreFailure>;
    pin(threadId: string, projectId: number, view: PinnedView): Effect.Effect<boolean, HarnessFailure>;
    unpin(threadId: string, projectId: number, view: PinnedView): Effect.Effect<boolean, HarnessFailure>;
    changed(subscriber: (threadId: string) => Effect.Effect<void, HarnessFailure>): () => void;
  }
>()('threads/ThreadPins') {}

export class PinOffers extends Context.Service<
  PinOffers,
  {
    require(plugin: string, view: string): Effect.Effect<void, ThreadInputRefused<'view-not-pinnable'>>;
  }
>()('threads/PinOffers') {}
