import { Context, Data, type Effect } from 'effect';

export type Tick = {
  readonly owner: string;
  readonly name: string;
  readonly scheduledAt: number;
  readonly startedAt: number;
  readonly skipped: number;
};

export class TickRefused extends Data.TaggedError('TickRefused')<{ readonly reason: string }> {}

export class Ticks extends Context.Service<Ticks, { deliver(tick: Tick): Effect.Effect<void, TickRefused> }>()('tagma/schedule/Ticks') {}
