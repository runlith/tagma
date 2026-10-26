import { Context, Effect } from 'effect';

export class Lifecycle extends Context.Service<
  Lifecycle,
  {
    readonly stop: (reason: string) => Effect.Effect<void>;
    readonly start: () => Effect.Effect<void>;
  }
>()('sample/Lifecycle') {}

export const live = Lifecycle.of({
  stop: (reason) => Effect.log(reason),
  start: () => Effect.void,
});
