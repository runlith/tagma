import { Context, type Effect } from 'effect';

export class Handoff extends Context.Service<
  Handoff,
  {
    readonly leaving: Effect.Effect<boolean>;
    readonly opened: Effect.Effect<void>;
  }
>()('tagma/speech/Handoff') {}
