import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { requestEffect } from './httpRequest.js';

it.live('a native HTTP call returns the response after its request scope has closed', () =>
  Effect.gen(function* () {
    let released = false;
    const handler = Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          released = true;
        }),
      );
      return yield* HttpServerResponse.json({ code: 'closed' }, { status: 409 });
    });
    const answer = yield* requestEffect(handler, new Request('http://tagma/refused'));
    expect(answer).toEqual({ status: 409, body: { code: 'closed' } });
    expect(released).toBe(true);
  }),
);

it.live('interrupting an HTTP call waits for the request finalizer before returning', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const releasing = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    const handler = Effect.interruptible(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Deferred.succeed(entered, undefined), () =>
          Effect.andThen(Deferred.succeed(releasing, undefined), Deferred.await(release)),
        );
        return yield* Effect.never;
      }),
    );
    const calling = yield* Effect.forkScoped(requestEffect(handler, new Request('http://tagma/blocked')));
    yield* Deferred.await(entered);
    const interrupting = yield* Effect.forkScoped(Effect.andThen(Fiber.interrupt(calling), Deferred.succeed(cancelled, undefined)));
    yield* Deferred.await(releasing);
    yield* Effect.yieldNow;
    const returnedBeforeRelease = yield* Deferred.isDone(cancelled);
    yield* Deferred.succeed(release, undefined);
    expect(returnedBeforeRelease).toBe(false);
    yield* Fiber.join(interrupting);
    expect(yield* Deferred.isDone(cancelled)).toBe(true);
  }),
);
