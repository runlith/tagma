import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { liveProtocol } from '../../../platform/contract/wire/live.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { LiveRpc } from '../composed.js';
import { liveDoorLayer } from '../socketDoor.js';
import type { DoorFixture } from '../doorFixture.js';

export const windowChannel = Effect.fn('testing.windowChannel')(function* (world: DoorFixture['Service']) {
  const data = yield* world.directory('window-channel');
  const connected = Layer.unwrap(
    Effect.map(HttpServer.HttpServer, (server) =>
      liveProtocol(`ws://127.0.0.1:${(server.address as { port: number }).port}${TAGMA_SOCKET_PATH}`),
    ),
  );
  const served = connected.pipe(
    Layer.provideMerge(HttpRouter.serve(liveDoorLayer(world.runtime, data), { disableListenLog: true, disableLogger: true })),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' })),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  return yield* Effect.provide(RpcClient.make(LiveRpc), yield* Layer.build(served));
});
