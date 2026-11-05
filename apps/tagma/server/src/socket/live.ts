import { Cause, Clock, Effect, Exit, Layer, Queue, Schema, Stream } from 'effect';
import { defected } from '@runlith/activity/Activity';
import type { FeedDeclaration, FeedPlace } from '../platform/contract/wire/operation.js';
import { SentFrames } from './frames.js';
import { HttpMiddleware, HttpRouter, HttpServerRequest } from 'effect/http';
import { type Rpc, type RpcGroup, type RpcMessage, type RpcSerialization, RpcServer } from 'effect/rpc';
import * as Socket from 'effect/socket/Socket';
import { CallLog, TAGMA_SOCKET_PATH } from './rpc.js';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { liveSerialization } from '../platform/contract/wire/live.js';
import type { SocketOperations } from '../invocation/contract/service/socketOperations.js';
import { CallDevice, ConnectionHeaders } from '../invocation/contract/service/admission.js';
import type { Connections } from './connections.js';

const LOCAL_DEVICE = 'local';

export const websocketHttpTracing = HttpMiddleware.layerTracerDisabledForUrls([TAGMA_SOCKET_PATH]);

export type LiveHandlers<Rpcs extends Rpc.Any> = {
  readonly [Current in Rpcs as Current['_tag']]: Rpc.ToHandlerFn<Current, SocketOperations>;
};

export const liveLayer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: LiveHandlers<Rpcs>,
  verbs: Readonly<Record<string, OperationId>>,
  connections: Connections | null,
  feeds: readonly FeedDeclaration[] = [],
) =>
  Layer.unwrap(
    Effect.sync(() => {
      const handling = handlings();
      return RpcServer.layer(group, { disableFatalDefects: true }).pipe(
        Layer.provide(group.toLayer(handlers)),
        Layer.provide(websocketLayer(connections, feeds, handling)),
        Layer.provide(callLogLayer(verbs, handling)),
        Layer.provide(liveSerialization),
      );
    }),
  );

type Handling = 'running' | 'died';

const handlings = () => {
  const held = new Map<number, Map<string, Handling>>();
  const mark = (clientId: number, requestId: string, handling: Handling) => {
    const of = held.get(clientId) ?? new Map<string, Handling>();
    of.set(requestId, handling);
    held.set(clientId, of);
  };
  return {
    mark,
    take: (clientId: number, requestId: string): Handling | undefined => {
      const of = held.get(clientId);
      const handling = of?.get(requestId);
      of?.delete(requestId);
      if (of?.size === 0) held.delete(clientId);
      return handling;
    },
    drop: (clientId: number) => void held.delete(clientId),
  };
};

type Handlings = ReturnType<typeof handlings>;

const callLogLayer = (verbs: Readonly<Record<string, OperationId>>, handling: Handlings) =>
  Layer.succeed(
    CallLog,
    CallLog.of((handler, request) => {
      const operation = verbs[request.rpc._tag];
      const requestId = String(request.requestId);
      handling.mark(request.client.id, requestId, 'running');
      return Effect.annotateLogs(
        handler,
        operation === undefined ? { endpoint: request.rpc._tag } : { endpoint: request.rpc._tag, operation },
      ).pipe(
        Effect.tapCause((cause) =>
          Cause.hasDies(cause) && !Cause.hasInterrupts(cause)
            ? Effect.andThen(
                Effect.sync(() => handling.mark(request.client.id, requestId, 'died')),
                operation === undefined ? defected(cause, `live ${request.rpc._tag}`) : Effect.void,
              )
            : Effect.void,
        ),
      );
    }),
  );

const websocketLayer = (
  connections: Connections | null,
  feeds: readonly FeedDeclaration[],
  handling: Handlings,
): Layer.Layer<RpcServer.Protocol, never, RpcSerialization.RpcSerialization | HttpRouter.HttpRouter> =>
  Layer.effect(
    RpcServer.Protocol,
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
      let generation = 0;
      yield* router.add(
        'GET',
        TAGMA_SOCKET_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const device = yield* CallDevice;
          const current = ++generation;
          const key = device ?? (connections?.remote === false ? LOCAL_DEVICE : null);
          const held = connections === null || key === null ? null : { connections, device: key };
          const instrumented = new Proxy(request, {
            get(target, property) {
              if (property !== 'upgrade') return Reflect.get(target, property, target);
              return Effect.map(target.upgrade, (socket) => observedSocket(socket, current, held));
            },
          });
          return yield* Effect.provideService(httpEffect, HttpServerRequest.HttpServerRequest, instrumented).pipe(
            Effect.provideService(ConnectionHeaders, request.headers),
            Effect.annotateSpans({ generation: current }),
          );
        }),
      );
      const sent = yield* SentFrames;
      const places = new Map(
        feeds.flatMap((feed) => (feed.place === undefined ? [] : [[feed.id, Schema.decodeUnknownResult(feed.place)] as const])),
      );
      const pending = new Map<number, Map<string, { place: FeedPlace; sentAt: number | null }>>();
      const endpoints = new Map<number, Map<string, string>>();
      const windows = new Map(feeds.flatMap((feed) => (feed.window === undefined ? [] : [[feed.id, feed.window] as const])));
      const flights = new Map<number, Map<string, Flight>>();
      let receiving: Receive | null = null;
      const disconnects = yield* Queue.make<number>();
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(protocol.disconnects), (clientId) => {
          pending.delete(clientId);
          endpoints.delete(clientId);
          flights.delete(clientId);
          handling.drop(clientId);
          return Queue.offer(disconnects, clientId);
        }),
      );
      const landed = (clientId: number, requestId: string, at: number): boolean => {
        const flight = flights.get(clientId)?.get(requestId);
        if (flight === undefined) return true;
        const sentAt = flight.sent.shift();
        if (sentAt !== undefined) flight.base = Math.min(flight.base, at - sentAt);
        if (!flight.waiting) return false;
        flight.waiting = false;
        return true;
      };
      const departed = (clientId: number, requestId: string, at: number): Effect.Effect<void> => {
        const flight = flights.get(clientId)?.get(requestId);
        if (flight === undefined || receiving === null) return Effect.void;
        flight.sent.push(at);
        if (flight.sent.length >= flight.window || at - flight.sent[0]! > 2 * flight.base) {
          flight.waiting = true;
          return Effect.void;
        }
        return receiving(clientId, { _tag: 'Ack', requestId: flight.id });
      };
      const forget = (clientId: number, requestId: string) => {
        const held = flights.get(clientId);
        held?.delete(requestId);
        if (held?.size === 0) flights.delete(clientId);
      };
      return {
        ...protocol,
        disconnects,
        run: (receive) => {
          receiving = receive;
          return protocol.run((clientId, request) => {
            if (request._tag === 'Request') {
              const window = windows.get(request.tag);
              if (window !== undefined) {
                const held = flights.get(clientId) ?? new Map<string, Flight>();
                held.set(String(request.id), { id: request.id, window, sent: [], base: Number.POSITIVE_INFINITY, waiting: false });
                flights.set(clientId, held);
              }
              const named = endpoints.get(clientId) ?? new Map<string, string>();
              named.set(String(request.id), request.tag);
              endpoints.set(clientId, named);
              const place = places.get(request.tag)?.(request.payload);
              if (place?._tag === 'Success') {
                const requests = pending.get(clientId) ?? new Map<string, { place: FeedPlace; sentAt: number | null }>();
                requests.set(String(request.id), { place: place.success, sentAt: null });
                pending.set(clientId, requests);
              }
            } else if (request._tag === 'Ack') {
              const requestId = String(request.requestId);
              if (flights.get(clientId)?.has(requestId))
                return Effect.flatMap(Clock.currentTimeMillis, (at) =>
                  landed(clientId, requestId, at) ? receive(clientId, request) : Effect.void,
                );
              const requests = pending.get(clientId);
              const frame = requests?.get(String(request.requestId));
              if (frame?.sentAt !== undefined && frame.sentAt !== null) {
                requests?.delete(String(request.requestId));
                if (requests?.size === 0) pending.delete(clientId);
                return Effect.andThen(receive(clientId, request), sent(frame.place, connections?.remote ?? false, frame.sentAt));
              }
            } else if (request._tag === 'Interrupt') {
              pending.get(clientId)?.delete(String(request.requestId));
              endpoints.get(clientId)?.delete(String(request.requestId));
              forget(clientId, String(request.requestId));
            } else if (request._tag === 'Eof') {
              pending.delete(clientId);
              endpoints.delete(clientId);
              flights.delete(clientId);
            }
            return receive(clientId, request);
          });
        },
        send: (clientId, response, transferables) =>
          Effect.suspend(() => {
            let died: Effect.Effect<void> = Effect.void;
            if (response._tag === 'Chunk') {
              const frame = pending.get(clientId)?.get(String(response.requestId));
              if (frame !== undefined && frame.sentAt === null) frame.sentAt = Date.now();
              const requestId = String(response.requestId);
              if (flights.get(clientId)?.has(requestId))
                return Effect.andThen(
                  protocol.send(clientId, response, transferables),
                  Effect.flatMap(Clock.currentTimeMillis, (at) => departed(clientId, requestId, at)),
                );
            } else if (response._tag === 'Exit') {
              const id = String(response.requestId);
              forget(clientId, id);
              const requests = pending.get(clientId);
              requests?.delete(id);
              if (requests?.size === 0) pending.delete(clientId);
              const named = endpoints.get(clientId);
              const endpoint = named?.get(id);
              named?.delete(id);
              const handled = handling.take(clientId, id);
              const defect = defectOf(response.exit);
              if (defect !== undefined) {
                const logged = Effect.logWarning('a live request ended by a defect', { endpoint, clientId, defect });
                died = handled === 'running' ? Effect.andThen(logged, unencoded(`live ${endpoint ?? 'request'}`, defect)) : logged;
              }
            } else if (response._tag === 'Defect') {
              died = Effect.logWarning('the live connection ended by a defect', { clientId, defect: response.defect });
            }
            return Effect.andThen(died, protocol.send(clientId, response, transferables));
          }),
        end: (clientId) => {
          pending.delete(clientId);
          endpoints.delete(clientId);
          flights.delete(clientId);
          handling.drop(clientId);
          return protocol.end(clientId);
        },
      } satisfies RpcServer.Protocol['Service'];
    }),
  );

type Held = { readonly connections: Connections; readonly device: string };

type Receive = Parameters<RpcServer.Protocol['Service']['run']>[0];

type Flight = {
  readonly id: RpcMessage.AckEncoded['requestId'];
  readonly window: number;
  readonly sent: number[];
  base: number;
  waiting: boolean;
};

function unencoded(place: string, encoded: unknown): Effect.Effect<void> {
  return Schema.decodeUnknownEffect(Schema.Defect())(encoded).pipe(
    Effect.match({ onSuccess: (defect) => defect, onFailure: () => encoded }),
    Effect.flatMap((defect) => defected(Cause.die(defect), place)),
  );
}

function defectOf(exit: RpcMessage.ExitEncoded<unknown, unknown>): unknown {
  if (exit._tag !== 'Failure') return undefined;
  for (const reason of exit.cause) if (reason._tag === 'Die') return reason.defect;
  return undefined;
}

function observedSocket(socket: Socket.Socket, generation: number, held: Held | null): Socket.Socket {
  const attributes = { generation };
  return Socket.make({
    writer: socket.writer,
    reader: Effect.gen(function* () {
      let recorded = false;
      const close = (closeCause: string) => {
        recorded = true;
        return Effect.void.pipe(Effect.withSpan('WebSocket.close', { attributes: { ...attributes, closeCause } }));
      };
      const reader = yield* socket.reader;
      if (held !== null) {
        const { write } = yield* socket.writer;
        const leave = yield* held.connections.add(held.device, (code, reason) => write(new Socket.CloseEvent(code, reason)));
        yield* Effect.addFinalizer(() => Effect.sync(leave));
      }
      yield* Effect.void.pipe(Effect.withSpan('WebSocket.open', { attributes }));
      yield* Effect.addFinalizer((exit) => (recorded ? Effect.void : close(socketCloseCause(exit))));
      return {
        upgrade: reader.upgrade,
        pull: reader.pull.pipe(
          Effect.tapError((failure) =>
            failure.reason._tag === 'SocketCloseError' && !recorded ? close(`${failure.reason._tag}:${failure.reason.code}`) : Effect.void,
          ),
        ),
      };
    }),
  });
}

function socketCloseCause(exit: Exit.Exit<unknown, unknown>): string {
  if (Exit.isSuccess(exit)) return 'completed';
  for (const reason of exit.cause.reasons) {
    const failure = Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : undefined;
    if (failure instanceof Socket.SocketCloseError) return `${failure._tag}:${failure.code}`;
    if (!Socket.SocketError.is(failure)) continue;
    return failure.reason._tag === 'SocketCloseError' ? `${failure.reason._tag}:${failure.reason.code}` : failure.reason._tag;
  }
  return Cause.hasInterrupts(exit.cause) ? 'interrupted' : 'failure';
}
