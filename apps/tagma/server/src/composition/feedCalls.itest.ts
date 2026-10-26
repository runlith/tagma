import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { Principal, type BindingId } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { InputRequest } from '@runlith/executions/protocol/input';
import { terminalChannel, terminalLanes } from '../executions/testing/doubles.js';
import type { TerminalGrants } from '../executions/contract/service/grants.js';
import type { TerminalRecord } from '../executions/contract/wire/terminals.js';
import { TERMINAL_INPUT_RECEIPTS, TERMINAL_INPUT_WRITE } from '../executions/contract/wire/feeds.js';
import { bindFeed, SocketOperations } from '../invocation/contract/service/socketOperations.js';
import { liveSerialization, rpcOf, type FeedHandler } from '../platform/contract/wire/live.js';
import { liveLayer, type LiveHandlers } from '../socket/live.js';
import { CallLog, TAGMA_SOCKET_PATH } from '../socket/rpc.js';

const group = RpcGroup.make(rpcOf(TERMINAL_INPUT_WRITE), rpcOf(TERMINAL_INPUT_RECEIPTS)).middleware(CallLog);

const record = {
  projectId: 1,
  execution: { installation: InstallationId.make('feed-socket-order'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  transport: 'pty',
  lifetime: 'held',
  targetKey: 'feed-socket-order',
  holder: Principal.make('operator'),
  origin: 'operator',
  revision: 0,
  acceptedAt: 0,
} as TerminalRecord;

it.live('the real RPC socket preserves frame order and shares lane receipts between two doors', () =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    let started = yield* Deferred.make<void>();
    let free = yield* Deferred.make<void>();
    let first = true;
    let text = '';
    const writing = {
      input: (_execution: unknown, _scope: unknown, request: InputRequest) =>
        Effect.sync(() => {
          const bytes = request.act._tag === 'Write' ? request.act.bytes : new Uint8Array();
          text += new TextDecoder().decode(bytes);
          return {
            _tag: 'InputAdmitted' as const,
            receipt: {
              execution: record.execution,
              sequence: request.sequence,
              cause: request.cause,
              bytes: bytes.length,
              acceptedThrough: ByteOffset.make(String(text.length)),
            },
          };
        }),
    } as unknown as Parameters<typeof terminalLanes>[0]['writing'];
    const lanes = yield* terminalLanes({ writing, grants: { watch: () => () => {} } as unknown as TerminalGrants['Service'] });
    const use = {
      terminals: { record: () => Effect.succeed(record) },
      writing,
      access: {
        prepare: ({ subject }: { readonly subject: { readonly binding: BindingId } }) =>
          Effect.succeed({
            grant: {
              projectId: 1,
              execution: record.execution,
              actor: Principal.make('operator'),
              targetKey: record.targetKey,
              binding: subject.binding,
              permissionRevision: 0,
            },
          }),
      },
      lanes: {
        open: lanes.open,
        close: lanes.close,
        listen: (...input: Parameters<typeof lanes.listen>) => Effect.andThen(lanes.listen(...input), Deferred.succeed(ready, undefined)),
        publish: lanes.publish,
        turn: lanes.turn,
      },
    } as unknown as Parameters<typeof terminalChannel>[0];
    const operations = SocketOperations.of({
      perform: () => Effect.die('this test invokes a feed, not an operation'),
      admitFeed: (declaration) =>
        Effect.suspend(() => {
          if (declaration.id !== TERMINAL_INPUT_WRITE.id || !first) return Effect.void;
          first = false;
          return Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(free));
        }),
    });
    const door = Effect.gen(function* () {
      const channel = terminalChannel(use);
      const handlers = {
        'terminal.input.write': bindFeed(TERMINAL_INPUT_WRITE, channel['terminal.input.write'] as FeedHandler),
        'terminal.input.receipts': bindFeed(TERMINAL_INPUT_RECEIPTS, channel['terminal.input.receipts'] as FeedHandler),
      } as LiveHandlers<RpcGroup.Rpcs<typeof group>>;
      const served = HttpRouter.serve(liveLayer(group, handlers, {}, null), { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' })),
        Layer.provide(Layer.succeed(SocketOperations, operations)),
      );
      const built = yield* Layer.build(served);
      const address = Context.get(built, HttpServer.HttpServer).address;
      const url = new URL(TAGMA_SOCKET_PATH, HttpServer.formatAddress(address));
      url.protocol = 'ws:';
      const protocol = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(url.href)),
        Layer.provide([liveSerialization, Socket.layerWebSocketConstructorGlobal]),
      );
      return yield* Effect.provide(RpcClient.make(group), yield* Layer.build(protocol));
    });
    const left = yield* door;
    const right = yield* door;
    const receipts = yield* Effect.forkChild(
      Stream.runCollect(
        Stream.take(
          left['terminal.input.receipts']({
            projectId: 1,
            execution: 'exec-1',
            incarnation: 0,
            binding: 'lane-1',
          }),
          4,
        ),
      ),
    );
    yield* Deferred.await(ready);
    const write = (client: typeof left, sequence: number, value: string, binding = 'lane-1') =>
      client['terminal.input.write']({
        projectId: 1,
        execution: 'exec-1',
        incarnation: 0,
        binding,
        sequence,
        cause: 'typed',
        act: { _tag: 'Write', bytes: new TextEncoder().encode(value) },
      });
    const before = yield* Effect.forkChild(write(left, 0, 'a'), { startImmediately: true });
    const after = yield* Effect.forkChild(write(left, 1, 'b'), { startImmediately: true });
    yield* write(left, 0, 'z', 'lane-2');
    yield* Deferred.succeed(free, undefined);
    yield* Fiber.join(before);
    yield* Fiber.join(after);
    expect(text).toBe('zab');
    started = yield* Deferred.make<void>();
    free = yield* Deferred.make<void>();
    first = true;
    const local = yield* Effect.forkChild(write(left, 2, 'c'), { startImmediately: true });
    yield* Deferred.await(started);
    const remote = yield* Effect.forkChild(write(right, 3, 'd'), { startImmediately: true });
    yield* write(right, 1, 'z', 'lane-2');
    yield* Deferred.succeed(free, undefined);
    yield* Fiber.join(local);
    yield* Fiber.join(remote);
    expect(text).toBe('zabzcd');
    const answers = yield* Fiber.join(receipts);
    expect(answers.map(({ sequence, kind }) => [sequence, kind])).toEqual([
      [0, 'applied'],
      [1, 'applied'],
      [2, 'applied'],
      [3, 'applied'],
    ]);
  }).pipe(Effect.timeout('10 seconds')),
);
