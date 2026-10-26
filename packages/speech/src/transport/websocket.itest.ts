import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import WebSocket from 'ws';
import { DuplexTransport } from '../protocol/transport.ts';
import { type OpenSocket, webSocketTransport } from './websocket.ts';

const openers: ReadonlyArray<readonly [string, OpenSocket]> = [
  ['the Bun global WebSocket', (url, protocols, headers) => new globalThis.WebSocket(url, { headers, protocols })],
  ['ws', (url, protocols, headers) => new WebSocket(url, protocols, { headers })],
];

describe.each(openers)('webSocketTransport over %s', (_name, open) => {
  it.live('sends headers and the subprotocol, carries text and binary both ways, and a normal close ends the stream', () =>
    Effect.gen(function* () {
      let seen: { readonly key: string | null; readonly protocol: string | null } | undefined;
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: (request, served) => {
              seen = { key: request.headers.get('x-key'), protocol: request.headers.get('sec-websocket-protocol') };
              return served.upgrade(request, { headers: { 'Sec-WebSocket-Protocol': 'speech' } })
                ? undefined
                : new Response('no', { status: 400 });
            },
            websocket: {
              message: (socket, message) => {
                socket.send(message);
                if (typeof message === 'string' && message === 'bye') socket.close(1000, 'done');
              },
            },
          }),
        ),
        (served) => Effect.sync(() => served.stop(true)),
      );
      const heard = yield* Effect.gen(function* () {
        const transport = yield* DuplexTransport;
        const link = yield* transport.open({
          url: `ws://127.0.0.1:${server.port}/`,
          headers: { 'x-key': 'secret' },
          protocols: ['speech'],
        });
        yield* link.send(new Uint8Array([1, 2, 3]));
        yield* link.send('bye');
        return yield* Stream.runCollect(link.messages);
      }).pipe(Effect.provide(webSocketTransport(open)));
      expect(seen).toEqual({ key: 'secret', protocol: 'speech' });
      expect(heard.map((message) => (typeof message === 'string' ? message : [...message]))).toEqual([[1, 2, 3], 'bye']);
    }),
  );

  it.live('an upgrade that never answers is released when its opener is interrupted', () =>
    Effect.gen(function* () {
      const accepted = Deferred.makeUnsafe<void>();
      const dropped = Deferred.makeUnsafe<void>();
      const silent = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: {
              open: () => void Deferred.doneUnsafe(accepted, Effect.void),
              data: () => {},
              close: () => void Deferred.doneUnsafe(dropped, Effect.void),
            },
          }),
        ),
        (listener) => Effect.sync(() => listener.stop(true)),
      );
      yield* Effect.gen(function* () {
        const transport = yield* DuplexTransport;
        const opening = yield* Effect.forkChild(
          Effect.scoped(transport.open({ url: `ws://127.0.0.1:${silent.port}/`, headers: {}, protocols: [] })),
        );
        yield* Deferred.await(accepted);
        yield* Fiber.interrupt(opening);
        yield* Deferred.await(dropped);
      }).pipe(Effect.provide(webSocketTransport(open)));
    }),
  );
});
