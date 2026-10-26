import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { DuplexTransport } from '@runlith/speech/protocol/transport';
import { Deferred, Effect, Fiber } from 'effect';
import { webSockets } from '../../speech.js';

it.live('interrupting an unanswered socket upgrade releases its accepted connection', () =>
  Effect.gen(function* () {
    const accepted = yield* Deferred.make<void>();
    const dropped = yield* Deferred.make<boolean>();
    const silent = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.listen({
          hostname: '127.0.0.1',
          port: 0,
          socket: {
            open: () => {
              Deferred.doneUnsafe(accepted, Effect.void);
            },
            data: () => {},
            close: () => {
              Deferred.doneUnsafe(dropped, Effect.succeed(true));
            },
          },
        }),
      ),
      (listener) => Effect.sync(() => listener.stop(true)),
    );
    const transport = yield* DuplexTransport;
    const opening = yield* Effect.forkChild(
      Effect.scoped(
        transport.open({
          url: `ws://127.0.0.1:${silent.port}/`,
          headers: {},
          protocols: [],
        }),
      ),
    );
    yield* Deferred.await(accepted);
    yield* Fiber.interrupt(opening);
    expect(yield* Deferred.await(dropped)).toBe(true);
  }).pipe(Effect.provide(webSockets)),
);
