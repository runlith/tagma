import { Cause, Effect, Exit, type Fiber, Queue, type Scope } from 'effect';

export const forkWatched = <A, E, R>(
  effect: Effect.Effect<void, never, R>,
  scope: Scope.Scope,
  owner: Queue.Enqueue<A, E | Cause.Done>,
): Effect.Effect<Fiber.Fiber<void>, never, R> =>
  Effect.forkIn(
    Effect.onExit(effect, (exit) =>
      Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? Queue.failCause(owner, exit.cause) : Effect.void,
    ),
    scope,
  );
