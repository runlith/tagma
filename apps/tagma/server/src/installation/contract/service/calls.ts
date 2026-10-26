import { Context, type Effect } from 'effect';

export class MachineCalls extends Context.Service<
  MachineCalls,
  {
    readonly live: Effect.Effect<number>;
  }
>()('tagma/installation/MachineCalls') {}
