import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Data, Deferred, Effect, FiberSet, Layer, Stream } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { liveProtocol } from '../../../platform/contract/wire/live.js';
import { websocketHttpTracing } from '../../../socket/live.js';
import { TAGMA_SOCKET_PATH } from '../../../socket/rpc.js';
import { LiveRpc } from '../composed.js';
import type { ServerRuntime } from '../../runtime.js';
import { liveDoorLayer } from '../socketDoor.js';

class FeedTargetsMissing extends Data.TaggedError('FeedTargetsMissing')<{ readonly message: string }> {}

export const loadFeeds = Effect.fn('loadFeeds')(function* (
  runtime: ServerRuntime,
  data: string,
  projectId: number,
  threadIds: readonly string[],
  enabled: boolean,
) {
  if (threadIds.length === 0) return yield* new FeedTargetsMissing({ message: 'the load feed needs at least one thread' });
  const connected = Layer.unwrap(
    Effect.map(HttpServer.HttpServer, (server) =>
      liveProtocol(`ws://127.0.0.1:${(server.address as { port: number }).port}${TAGMA_SOCKET_PATH}`),
    ),
  );
  const layers = connected.pipe(
    Layer.provideMerge(
      HttpRouter.serve(liveDoorLayer(runtime, data), { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provide(websocketHttpTracing),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' })),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const context = yield* Layer.build(layers);
  const client = yield* Effect.provide(RpcClient.make(LiveRpc), context);
  const workers = yield* FiberSet.make<void, unknown>();
  const frames: Record<string, number> = {};
  const ready: Deferred.Deferred<void>[] = [];
  const subscribe = Effect.fnUntraced(function* (name: string, stream: Stream.Stream<unknown, unknown>) {
    const first = yield* Deferred.make<void>();
    ready.push(first);
    yield* FiberSet.run(
      workers,
      Stream.runForEach(stream, () =>
        Effect.gen(function* () {
          frames[name] = (frames[name] ?? 0) + 1;
          yield* Deferred.succeed(first, undefined);
        }),
      ).pipe(Effect.andThen(Effect.die(new Error(`${name} subscription ended`)))),
    );
  });
  if (enabled) {
    for (let index = 0; index < 8; index += 1) {
      const threadId = threadIds[index % threadIds.length]!;
      yield* subscribe('thread.changes', client['thread.changes']({ projectId, threadId }));
      yield* subscribe('artifacts.thread', client['artifacts.thread']({ projectId, threads: [threadId] }));
    }
    for (let index = 0; index < 6; index += 1)
      yield* subscribe('worktrees.subscribe', client['worktrees.subscribe']({ projectId, start: 0, limit: 64 }));
    for (let index = 0; index < 4; index += 1) {
      yield* subscribe('commands.subscribe', client['commands.subscribe']({ projectId, ended: 50 }));
      yield* subscribe('threads.subscribe', client['threads.subscribe']({ projectId }));
      yield* subscribe('calls.subscribe', client['calls.subscribe']({ projectId, ended: 50 }));
      yield* subscribe('views.subscribe', client['views.subscribe']({ projectId }));
      yield* subscribe('graph.subscribe', client['graph.subscribe']({ projectId }));
      yield* subscribe('holdings.subscribe', client['holdings.subscribe']({ projectId }));
      yield* subscribe('checkout.subscribe', client['checkout.subscribe']({ projectId }));
      yield* subscribe('tree.subscribe', client['tree.subscribe']({ projectId }));
    }
    yield* Effect.raceFirst(
      Effect.forEach(ready, Deferred.await, { discard: true, concurrency: 'unbounded' }),
      Effect.andThen(FiberSet.join(workers), Effect.never),
    );
  }
  return {
    client,
    frames: () => ({ ...frames }),
    failure: Effect.andThen(FiberSet.join(workers), Effect.never),
  };
});
