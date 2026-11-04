import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ATTACH_FEED, type Order } from '@tagma/server/desktop-browser/contract/wire/channel';
import { liveSerialization, rpcOf } from '@tagma/server/platform/contract/wire/live';
import { Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import * as Socket from 'effect/socket/Socket';
import { TestClock } from 'effect/testing';

const GROUP = RpcGroup.make(rpcOf(ATTACH_FEED));

it.effect('a tape without heartbeat keeps its attach feed through a minute in which the server answers no ping', () =>
  Effect.gen(function* () {
    const written = yield* Queue.unbounded<string>();
    const incoming = yield* Queue.unbounded<string>();
    const silent = Socket.make({
      reader: Effect.succeed({
        pull: Effect.map(Queue.take(incoming), (frame) => [frame] as const),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({
        write: (chunk) => (typeof chunk === 'string' ? Effect.asVoid(Queue.offer(written, chunk)) : Effect.void),
        writeAll: (chunks) => Effect.forEach(chunks, (chunk) => Queue.offer(written, String(chunk)), { discard: true }),
      }),
    });
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket({ heartbeat: false }).pipe(Layer.provide([Layer.succeed(Socket.Socket, silent), liveSerialization])),
    );
    const client = yield* Effect.provide(RpcClient.make(GROUP), protocol);
    const orders = yield* Queue.unbounded<Order>();
    const feed = yield* client.attach_browser_host({ host: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', pid: 1 }).pipe(
      Stream.runForEach((order) => Queue.offer(orders, order)),
      Effect.forkScoped,
    );
    const request = JSON.parse(yield* Queue.take(written)) as { readonly id: string };
    yield* TestClock.adjust('1 minute');
    yield* Queue.offer(incoming, JSON.stringify({ _tag: 'Chunk', requestId: request.id, values: [{ kind: 'attached', generation: 1 }] }));
    const first = yield* Effect.raceFirst(
      Queue.take(orders),
      Effect.flatMap(Fiber.await(feed), (ended) => Effect.die(`the attach feed ended: ${String(ended)}`)),
    );
    expect(first).toEqual({ kind: 'attached', generation: 1 });
  }),
);
