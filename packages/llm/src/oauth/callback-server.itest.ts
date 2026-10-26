import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { callbackServer } from './callback-server';
import { OAuthFlowFailed } from './flows/vendorPayload';

it.live('a wrong path answers 404 and settles nothing; the valid callback settles code and state', () =>
  Effect.gen(function* () {
    const server = yield* callbackServer({ path: '/callback' });
    const wrong = yield* Effect.promise(() => fetch(`http://127.0.0.1:${server.port}/nowhere`));
    expect(wrong.status).toBe(404);
    const ok = yield* Effect.promise(() => fetch(`http://127.0.0.1:${server.port}/callback?code=abc&state=xyz`));
    expect(ok.status).toBe(200);

    expect(yield* server.result).toEqual({ code: 'abc', state: 'xyz', redirectUri: server.redirectUri });
  }),
);

it.live('a flow can publish the numeric loopback host its OAuth registration requires', () =>
  Effect.gen(function* () {
    const server = yield* callbackServer({ path: '/callback', redirectHost: '127.0.0.1' });
    expect(new URL(server.redirectUri).hostname).toBe('127.0.0.1');
  }),
);

it.live('an OAuth error parameter fails the result with the provider sentence, as the tagged failure', () =>
  Effect.gen(function* () {
    const server = yield* callbackServer({ path: '/callback' });
    const answered = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${server.port}/callback?error=access_denied&error_description=nope`),
    );
    expect(answered.status).toBe(400);
    const failure = yield* Effect.flip(server.result);

    expect(failure).toBeInstanceOf(OAuthFlowFailed);
    expect(failure.message).toBe('OAuth error: access_denied (nope)');
  }),
);

it.effect('the timeout fails the result and closing the scope releases the listener', () =>
  Effect.gen(function* () {
    const outcome = yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* callbackServer({ path: '/callback', timeoutMs: 5_000 });
        const waiting = yield* Effect.forkChild(Effect.flip(server.result));
        yield* TestClock.adjust(5_000);
        const failure = yield* Fiber.join(waiting);
        return { failure, port: server.port };
      }),
    );

    expect(outcome.failure).toBeInstanceOf(OAuthFlowFailed);
    expect(outcome.failure.message).toBe('OAuth login timed out');
    const refused = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${outcome.port}/callback`).then(
        () => false,
        () => true,
      ),
    );
    expect(refused).toBe(true);
  }),
);
