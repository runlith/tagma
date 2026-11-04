import { expect } from 'bun:test';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { it } from '@runlith/effect-test';
import { Context, Effect, Exit, Layer, Schema, Stream } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { SocketOperations } from '../invocation/contract/service/socketOperations.js';
import { liveProtocol } from '../platform/contract/wire/live.js';
import { liveLayer, type LiveHandlers } from './live.js';
import { CallLog, TAGMA_SOCKET_PATH } from './rpc.js';

const group = RpcGroup.make(
  Rpc.make('probe.subscribe', { success: Schema.Number, stream: true }),
  Rpc.make('probe.break', { success: Schema.Number }),
).middleware(CallLog);

const handlers = {
  'probe.subscribe': () => Stream.make('not a number' as unknown as number),
  'probe.break': () => Effect.die(new Error('the probe broke')),
} as LiveHandlers<RpcGroup.Rpcs<typeof group>>;

const served = Effect.fnUntraced(function* () {
  const recording = activityRecording();
  const server = HttpRouter.serve(liveLayer(group, handlers, {}, null), { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' })),
    Layer.provide(
      Layer.succeed(SocketOperations, SocketOperations.of({ perform: () => Effect.die('unused'), admitFeed: () => Effect.void })),
    ),
    Layer.provide(Layer.succeed(ActivityLog, recording.log)),
  );
  const address = Context.get(yield* Layer.build(server), HttpServer.HttpServer).address;
  const url = new URL(TAGMA_SOCKET_PATH, HttpServer.formatAddress(address));
  url.protocol = 'ws:';
  const protocol = liveProtocol(url.href).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
  const client = yield* Effect.provide(RpcClient.make(group), yield* Layer.build(protocol));
  const defects = () => recording.activities().flatMap((activity) => activity.notes.filter((note) => note.type === 'defect'));
  return { client, defects };
});

it.live('a live request whose answer cannot be encoded ends by a defect that the operator`s error list keeps', () =>
  Effect.gen(function* () {
    const { client, defects } = yield* served();
    expect(Exit.isFailure(yield* Effect.exit(Stream.runCollect(client['probe.subscribe']())))).toBe(true);
    expect(defects()).toMatchObject([{ place: 'live probe.subscribe', message: expect.stringContaining('Expected number') }]);
  }),
);

it.live('a live handler that dies is kept once with its own error', () =>
  Effect.gen(function* () {
    const { client, defects } = yield* served();
    expect(Exit.isFailure(yield* Effect.exit(client['probe.break']()))).toBe(true);
    expect(defects()).toMatchObject([{ place: 'live probe.break', message: 'the probe broke' }]);
  }),
);
