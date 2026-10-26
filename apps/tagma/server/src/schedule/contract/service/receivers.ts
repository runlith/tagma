import { Context, type Effect } from 'effect';
import type { Tick, TickRefused, Ticks } from './ticks.js';

export class TickReceivers extends Context.Service<
  TickReceivers,
  {
    register(owner: string, receiver: Ticks['Service']): () => void;
    deliver(tick: Tick): Effect.Effect<void, TickRefused>;
  }
>()('schedule/Receivers') {}
