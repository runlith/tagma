import { Duration, Effect, Layer, Queue, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import * as Socket from 'effect/socket/Socket';
import { liveSerialization, rpcOf } from '../../platform/contract/wire/live.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import { ATTACH_FEED, type Call, framed, type Order, REPORT_PATH, type Report } from '../contract/wire/channel.js';

export const HOST = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

const group = RpcGroup.make(rpcOf(ATTACH_FEED));

export type Called = { readonly id: number; readonly call: Call };

const wsAt = (url: URL, path: string): URL => {
  const at = new URL(path, url);
  at.protocol = 'ws:';
  return at;
};

export const fakeHost = Effect.fnUntraced(function* (url: URL) {
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket({ heartbeat: false }).pipe(
      Layer.provide(Socket.layerWebSocket(wsAt(url, TAGMA_SOCKET_PATH).toString(), { openTimeout: Duration.infinity })),
      Layer.provide([liveSerialization, Socket.layerWebSocketConstructorGlobal]),
    ),
  );
  const client = yield* Effect.provide(RpcClient.make(group), protocol);
  const orders = yield* Queue.unbounded<Order>();
  yield* client.attach_browser_host({ host: HOST, pid: process.pid }).pipe(
    Stream.runForEach((order) => Queue.offer(orders, order)),
    Effect.forkScoped,
  );
  const first = yield* Queue.take(orders);
  if (first.kind !== 'attached') return yield* Effect.die(`the feed opened with ${first.kind}`);
  const reports = wsAt(url, REPORT_PATH);
  reports.searchParams.set('host', HOST);
  reports.searchParams.set('generation', String(first.generation));
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket>((resume) => {
      const opened = new WebSocket(reports);
      opened.addEventListener('open', () => resume(Effect.succeed(opened)));
      opened.addEventListener('error', () => resume(Effect.die('the report socket did not open')));
    }),
    (open) => Effect.sync(() => open.close()),
  );
  let seq = 0;
  const next = () => ++seq;
  const sent = (report: Report, tail?: string) => framed(report, tail).forEach((part) => socket.send(part));
  const called = Effect.gen(function* () {
    for (;;) {
      const order = yield* Queue.take(orders);
      if (order.kind === 'call') return { id: order.id, call: order.call } satisfies Called;
    }
  });
  const answer = (id: number, value: unknown = null) => sent({ kind: 'answer', seq: next(), id, value });
  return { generation: first.generation, called, answer, sent, next, close: () => socket.close() };
});
