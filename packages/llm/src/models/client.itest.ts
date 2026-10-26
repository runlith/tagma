import { createServer } from 'node:http';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit } from 'effect';
import { HttpClientRequest } from 'effect/http';
import { HttpExecutor } from '../llm/route/executor';
import { openModelClient } from './client';

it.live(
  'closing the model client layer releases its pooled connection',
  () =>
    Effect.gen(function* () {
      const closed = yield* Deferred.make<void>();
      let connected = false;
      let disconnected = false;
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createServer((_request, response) => {
            response.end('answer');
          }),
        ),
        (server) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve, reject) => {
                server.close((failure) => (failure === undefined ? resolve() : reject(failure)));
              }),
          ),
      );
      server.on('connection', (socket) => {
        connected = true;
        socket.once('close', () => {
          disconnected = true;
          Deferred.doneUnsafe(closed, Exit.void);
        });
      });
      yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
      const address = server.address();
      if (address === null || typeof address === 'string') return yield* Effect.die('the loopback server did not bind a TCP address');
      const lifetime = yield* Effect.scope;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const client = yield* openModelClient();
          const executor = Context.get(client, HttpExecutor);
          const response = yield* executor.execute(HttpClientRequest.get(`http://127.0.0.1:${address.port}`), lifetime);
          expect(yield* response.text).toBe('answer');
          expect(connected && !disconnected).toBe(true);
        }),
      );
      yield* Deferred.await(closed);
      expect(disconnected).toBe(true);
    }),
  1000,
);
