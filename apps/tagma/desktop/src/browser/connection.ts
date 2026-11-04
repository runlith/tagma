import {
  ATTACH_FEED,
  type Call,
  type Failure,
  framed,
  REPORT_PATH,
  type Report,
} from '@tagma/server/desktop-browser/contract/wire/channel';
import type { DomainBlock } from '@tagma/server/browser/contract/wire/domains';
import type { HostEvent } from '@tagma/server/browser/contract/wire/host';
import type { WindowDeclaration } from '@tagma/server/executions/contract/wire/load';
import { liveProtocol, rpcOf } from '@tagma/server/platform/contract/wire/live';
import { TAGMA_SOCKET_PATH } from '@tagma/server/socket/rpc';
import { Data, Deferred, Effect, Layer, Stream } from 'effect';
import { RpcClient, RpcGroup } from 'effect/rpc';
import * as Socket from 'effect/socket/Socket';

const GROUP = RpcGroup.make(rpcOf(ATTACH_FEED));

const RETRY = '1 second';
const UNREAD_LIMIT = 128 * 1024 * 1024;
const UNREAD_CLOSE = 4000;

export type SessionEnd = 'detached' | 'taken' | 'closed';

export type Reporter = {
  answer(id: number, value: unknown): void;
  bytes(id: number, base64: string): void;
  fail(id: number, failure: Failure): void;
  event(event: HostEvent): void;
  blocked(watch: number, block: DomainBlock): void;
  cdp(session: number, text: string): void;
  ended(session: number, end: SessionEnd): void;
};

export type Declarations = {
  declare(declaration: WindowDeclaration): void;
};

export type Executor = {
  attach(reporter: Reporter): void;
  call(id: number, call: Call): void;
  cdp(session: number, text: string): void;
  detach(): void;
};

export type Declarer = {
  attach(declarations: Declarations): void;
  detach(): void;
};

export type Served = {
  readonly surface: URL;
  readonly ours: () => Promise<boolean>;
  readonly host: string;
  readonly executor: Executor;
  readonly declarer: Declarer;
};

class ReportsClosed extends Data.TaggedError('ReportsClosed')<{ readonly message: string }> {}

class ServerUnread extends Data.TaggedError('ServerUnread')<{ readonly message: string }> {}

const socketUrl = (surface: URL, path: string): URL => {
  const url = new URL(path, surface);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
};

const reports = (url: URL) =>
  Effect.acquireRelease(
    Effect.callback<{ readonly socket: WebSocket; readonly closed: Deferred.Deferred<void, ReportsClosed> }, ReportsClosed>((resume) => {
      const socket = new WebSocket(url);
      const closed = Deferred.makeUnsafe<void, ReportsClosed>();
      let open = false;
      socket.addEventListener('open', () => {
        open = true;
        resume(Effect.succeed({ socket, closed }));
      });
      socket.addEventListener('close', (event) => {
        const failure = new ReportsClosed({
          message: `the report socket closed with ${event.code}${event.reason === '' ? '' : `: ${event.reason}`}`,
        });
        if (!open) resume(Effect.fail(failure));
        Deferred.doneUnsafe(closed, Effect.fail(failure));
      });
      return Effect.sync(() => socket.close());
    }),
    ({ socket }) => Effect.sync(() => socket.close()),
  );

const reporterOn = (socket: WebSocket): Reporter & Declarations => {
  let seq = 0;
  const send = (report: Report, tail?: string) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > UNREAD_LIMIT) {
      socket.close(UNREAD_CLOSE, `the server left ${socket.bufferedAmount} bytes of reports unread`);
      return;
    }
    for (const part of framed(report, tail)) socket.send(part);
  };
  return {
    answer: (id, value) => send({ kind: 'answer', seq: ++seq, id, value }),
    bytes: (id, base64) => send({ kind: 'bytes', seq: ++seq, id }, `{"result":{"data":"${base64}"}}`),
    fail: (id, failure) => send({ kind: 'failure', seq: ++seq, id, failure }),
    event: (event) => send({ kind: 'event', seq: ++seq, event }),
    blocked: (watch, block) => send({ kind: 'blocked', seq: ++seq, watch, block }),
    cdp: (session, text) => send({ kind: 'cdp', seq: ++seq, session }, text),
    ended: (session, end) => send({ kind: 'ended', seq: ++seq, session, end }),
    declare: (declaration) => send({ kind: 'declaration', seq: ++seq, declaration }),
  };
};

const generation = (served: Served) =>
  Effect.scoped(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(
        liveProtocol(socketUrl(served.surface, TAGMA_SOCKET_PATH).toString()).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      );
      const client = yield* Effect.provide(RpcClient.make(GROUP), protocol);
      const lost = yield* Deferred.make<void, ReportsClosed>();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          served.declarer.detach();
          served.executor.detach();
        }),
      );
      const orders = client.attach_browser_host({ host: served.host, pid: process.pid }).pipe(
        Stream.runForEach((order) => {
          switch (order.kind) {
            case 'attached':
              return Effect.gen(function* () {
                const url = socketUrl(served.surface, REPORT_PATH);
                url.searchParams.set('host', served.host);
                url.searchParams.set('generation', String(order.generation));
                const { socket, closed } = yield* reports(url);
                yield* Effect.forkScoped(Deferred.into(Deferred.await(closed), lost));
                const reporter = reporterOn(socket);
                served.executor.attach(reporter);
                served.declarer.attach(reporter);
              });
            case 'call':
              return Effect.sync(() => served.executor.call(order.id, order.call));
            case 'cdp':
              return Effect.sync(() => served.executor.cdp(order.session, order.text));
          }
        }),
      );
      return yield* Effect.raceFirst(orders, Deferred.await(lost));
    }),
  );

export const serveHost = (served: Served) =>
  Effect.forever(
    Effect.gen(function* () {
      const ours = yield* Effect.tryPromise({
        try: served.ours,
        catch: (cause) => new ServerUnread({ message: String(cause) }),
      }).pipe(
        Effect.catchTag('ServerUnread', (unread) =>
          Effect.as(Effect.logWarning(`desktop browser: whose server answers was not read: ${unread.message}`), false),
        ),
      );
      if (ours) {
        const ended = yield* Effect.exit(generation(served));
        yield* Effect.logInfo(
          `desktop browser: the channel to the server ended: ${ended._tag === 'Failure' ? String(ended.cause) : 'done'}`,
        );
      }
      yield* Effect.sleep(RETRY);
    }),
  );
