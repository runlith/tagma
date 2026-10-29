import { Context, type Effect, type Scope } from 'effect';

export class ThreadRuns extends Context.Service<
  ThreadRuns,
  {
    running(threadId: string): Effect.Effect<boolean>;
    ending(threadId: string): Effect.Effect<Effect.Effect<void>, never, Scope.Scope>;
  }
>()('tagma/browser/ThreadRuns') {}
