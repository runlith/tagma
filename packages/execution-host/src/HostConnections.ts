import {
  Data,
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  type Tracer,
} from 'effect';
import { Endpoint, type EndpointUnavailable } from './Endpoint';
import * as Socket from 'effect/socket/Socket';
import type * as SocketServer from 'effect/socket/SocketServer';
import { ExecutionCapacity } from './ExecutionCapacity';
import { HostRequestKey, type Incarnation } from '@runlith/executions/protocol/execution';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { LaneInput } from '@runlith/executions/protocol/lane';
import type { LoadReading } from '@runlith/executions/protocol/evidence';
import type { ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import type { RecordRange } from '@runlith/executions/protocol/record';
import { ConnectionId, type CustodianEpoch, type Registration, type Role } from '@runlith/executions/protocol/registration';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { rangeText } from '@runlith/executions/protocol/artifact';
import type { Served } from '@runlith/executions/protocol/capability';
import {
  ClientFrame,
  ClientMessageText,
  clientOpening,
  type Event,
  fatalFault,
  frameSize,
  HostFrame,
  type HostMessage,
  HostMessageText,
  peekWireVersion,
  type Request,
  type RequestId,
  type HostAnswer,
  servedOn,
  SubscriptionId,
  type SubscriptionEnding,
  unsupported,
  unsupportedCall,
  WIRE_MAGIC,
  WIRE_RANGE,
  WIRE_VERSION,
  type WireFault,
  type WireLimits,
  WirePreface,
} from '@runlith/executions/protocol/wire';
import {
  EMPTY_PAYLOAD,
  encodeFrame,
  frameReader,
  takeFrames,
  WIRE_DISPATCH_SPAN,
  YIELD_FRAME_BYTES,
} from '@runlith/executions/protocol/frames';
import { type WriteFrame, makeConnectionWriter } from './ConnectionWriter';
import { Credentials } from './Credentials';
import { Custodian } from './Custodian';
import { HostAdmission } from './HostAdmission';
import {
  countCreditFault,
  countFiberFailed,
  countOversized,
  countRefusal,
  countSeatReclaimed,
  noteRefusal,
  noteReplyWait,
  noteSendQueueDepth,
  reportDeadFiber,
} from './hostTelemetry';

const decodeClient = Schema.decodeUnknownEffect(Schema.fromJsonString(ClientFrame));
const decodeClientMessage = Schema.decodeUnknownEffect(ClientMessageText);
const encodeHost = Schema.encodeUnknownEffect(Schema.fromJsonString(HostFrame));
const encodeHostMessage = Schema.encodeUnknownEffect(HostMessageText);
const text = new TextEncoder();
const chars = new TextDecoder();
const jsonOf = (said: string): { readonly message?: unknown } | undefined => {
  try {
    const value: unknown = JSON.parse(said);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
};
const PREFACE = text.encode(Schema.encodeSync(Schema.fromJsonString(WirePreface))({ magic: WIRE_MAGIC, wire: WIRE_RANGE }));

export type Admitted = {
  readonly connection: ConnectionId;
  readonly role: Role;
  readonly epoch: CustodianEpoch;
  readonly request: RequestId;
  readonly body: Request;
  readonly payload: Uint8Array;
  readonly parent: Tracer.AnySpan | undefined;
  readonly reply: (response: HostAnswer, payload?: Uint8Array) => Effect.Effect<void>;
  readonly refuse: (refusal: Refusal) => Effect.Effect<void>;
  readonly subscribe: (credits: number) => Effect.Effect<Subscription | undefined>;
  readonly hasSubscription: (subscription: SubscriptionId) => Effect.Effect<boolean>;
};

export type Subscription = {
  readonly id: SubscriptionId;
  readonly credits: number;
  readonly bytes: (range: RecordRange, bytes: Uint8Array) => Effect.Effect<boolean>;
  readonly state: (summary: ExecutionSummary) => Effect.Effect<boolean>;
  readonly screen: (update: ScreenFeedItem) => Effect.Effect<boolean>;
  readonly inventory: (update: InventoryFeedItem) => Effect.Effect<boolean>;
  readonly inputs: (input: LaneInput) => Effect.Effect<boolean>;
  readonly load: (reading: LoadReading) => Effect.Effect<boolean>;
  readonly settled: () => Effect.Effect<boolean>;
  readonly end: (ending: SubscriptionEnding) => Effect.Effect<void>;
  readonly closed: Effect.Effect<void>;
};

class ConnectionOver extends Data.TaggedError('ConnectionOver')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const RECOVERY_SEATS = 1;

export class HostConnections extends Context.Service<
  HostConnections,
  {
    readonly admitted: Effect.Effect<Admitted>;
    readonly open: Effect.Effect<void>;
    readonly close: Effect.Effect<void>;
    readonly descriptorReserve: () => number;
    readonly endpoint: string;
    readonly connections: Effect.Effect<number>;
  }
>()('@runlith/execution-host/HostConnections') {
  static layer(
    registration: Registration,
    incarnation: Incarnation,
    limits: WireLimits,
    served: Served,
  ): Layer.Layer<
    HostConnections,
    SocketServer.SocketServerError | EndpointUnavailable,
    Credentials | Custodian | HostAdmission | Endpoint | ExecutionCapacity
  > {
    return Layer.effect(HostConnections, make({ registration, incarnation, limits, served }));
  }
}

type Reader = {
  readonly id: SubscriptionId;
  readonly credit: Semaphore.Semaphore;
  readonly granted: number;
  readonly outstanding: Ref.Ref<number>;
  readonly closed: Deferred.Deferred<void>;
};

const make = Effect.fn('HostConnections.make')(function* ({
  registration,
  incarnation,
  limits,
  served,
}: {
  readonly registration: Registration;
  readonly incarnation: Incarnation;
  readonly limits: WireLimits;
  readonly served: Served;
}) {
  const credentials = yield* Credentials;
  const capacity = yield* ExecutionCapacity;
  const custodian = yield* Custodian;
  const admission = yield* HostAdmission;
  const endpoint = yield* Endpoint;
  const path = registration.endpoint.path;
  const own = yield* Scope.fork(yield* Effect.scope);
  const server = yield* endpoint.listen(registration).pipe(Scope.provide(own));

  const waiting = yield* Queue.bounded<Admitted>(limits.connections + RECOVERY_SEATS);
  const seats = yield* Semaphore.make(limits.connections);
  const spare = yield* Semaphore.make(RECOVERY_SEATS);
  const live = yield* Ref.make(0);
  const numbering = yield* Ref.make(0);
  const opened = yield* Ref.make(false);
  const closed = yield* Ref.make(false);

  const connection = Effect.fnUntraced(function* (
    socket: Socket.Socket,
    write: (message: HostMessage, payload: Uint8Array) => Effect.Effect<boolean>,
    encoded: (message: HostMessage, payload: Uint8Array) => Effect.Effect<WriteFrame | undefined>,
    event: (framed: WriteFrame, cost: number) => Effect.Effect<void>,
    provisional: boolean,
    dialect: Ref.Ref<number | undefined>,
    preface: Effect.Effect<boolean>,
  ) {
    const reader = frameReader(limits);
    const bound = yield* Ref.make<{ readonly connection: ConnectionId; readonly role: Role } | undefined>(undefined);
    const inFlight = yield* Ref.make<ReadonlySet<RequestId>>(new Set());
    const readers = yield* Ref.make<ReadonlyMap<SubscriptionId, Reader>>(new Map());

    const say = (message: HostMessage) => Effect.asVoid(write(message, EMPTY_PAYLOAD));

    const fault = (kind: WireFault['kind'], detail: string, request?: RequestId) =>
      say({ _tag: 'Fault', request: request, fault: { kind, detail } }).pipe(
        Effect.andThen(fatalFault({ kind, detail }) ? Effect.fail(new ConnectionOver({ detail: kind })) : Effect.void),
      );

    const withdraw = (request: RequestId) =>
      Ref.update(inFlight, (held) => {
        if (!held.has(request)) return held;
        const kept = new Set(held);
        kept.delete(request);
        return kept;
      });

    const release = Effect.fnUntraced(function* (id: SubscriptionId) {
      const held = yield* Ref.get(readers);
      const entry = held.get(id);
      if (entry === undefined) return;
      const kept = new Map(held);
      kept.delete(id);
      yield* Ref.set(readers, kept);
      yield* Deferred.succeed(entry.closed, undefined);
    });

    const answer = (request: RequestId) =>
      Effect.fnUntraced(function* (response: HostAnswer, payload: Uint8Array = EMPTY_PAYLOAD): Effect.fn.Return<boolean> {
        const held = yield* Ref.get(inFlight);
        if (!held.has(request)) return false;
        yield* withdraw(request);
        const [waited, wrote] = yield* Effect.timed(write({ _tag: 'Reply', request, body: response }, payload));
        yield* noteReplyWait(Duration.toMillis(waited));
        if (wrote) return true;
        const oversized: Refusal = {
          _tag: 'CapacityExceeded',
          reason: `the answer exceeds the ${limits.frameBytes} byte frame ceiling`,
        };
        yield* noteRefusal(oversized);
        yield* countOversized('reply');
        yield* say({ _tag: 'Reply', request, body: { _tag: 'Refused', refusal: oversized } });
        return false;
      });

    const push = Effect.fnUntraced(function* (entry: Reader, body: Event, payload: Uint8Array) {
      if (yield* Deferred.isDone(entry.closed)) return false;
      const framed = yield* encoded({ _tag: 'Event', body }, payload);
      if (framed === undefined) {
        yield* Effect.logError('a subscription event cannot be encoded; the subscription ends', {
          subscription: entry.id,
          event: body._tag,
        });
        yield* say({ _tag: 'Event', body: { _tag: 'Ended', subscription: entry.id, ending: 'unavailable' } });
        yield* release(entry.id);
        return false;
      }
      const cost = frameSize(framed.header.length, framed.payload.length);
      if (cost > limits.frameBytes) {
        yield* countOversized('delivery');
        yield* say({ _tag: 'Event', body: { _tag: 'Ended', subscription: entry.id, ending: 'unavailable' } });
        yield* release(entry.id);
        return false;
      }
      if (cost > entry.granted) {
        yield* countCreditFault('grant-too-small');
        yield* say({ _tag: 'Event', body: { _tag: 'Ended', subscription: entry.id, ending: 'unavailable' } });
        yield* release(entry.id);
        return false;
      }
      const taken = yield* Effect.raceFirst(Effect.as(entry.credit.take(cost), true), Effect.as(Deferred.await(entry.closed), false));
      if (!taken) return false;
      yield* Ref.update(entry.outstanding, (held) => held - cost);
      yield* event(framed, cost);
      return true;
    });

    const subscription = (entry: Reader): Subscription => ({
      id: entry.id,
      credits: entry.granted,
      bytes: (range, bytes) => push(entry, { _tag: 'Bytes', subscription: entry.id, range, bytes: bytes.length }, bytes),
      state: (summary) => push(entry, { _tag: 'State', subscription: entry.id, summary }, EMPTY_PAYLOAD),
      screen: (update) => push(entry, { _tag: 'Screen', subscription: entry.id, update }, EMPTY_PAYLOAD),
      inventory: (update) => push(entry, { _tag: 'Inventory', subscription: entry.id, update }, EMPTY_PAYLOAD),
      inputs: (input) => push(entry, { _tag: 'Inputs', subscription: entry.id, ...input }, EMPTY_PAYLOAD),
      load: (reading) => push(entry, { _tag: 'Load', subscription: entry.id, reading }, EMPTY_PAYLOAD),
      settled: () => push(entry, { _tag: 'ScreenSettled', subscription: entry.id }, EMPTY_PAYLOAD),
      end: Effect.fnUntraced(function* (ending) {
        if (yield* Deferred.isDone(entry.closed)) return;
        yield* say({ _tag: 'Event', body: { _tag: 'Ended', subscription: entry.id, ending } });
        yield* release(entry.id);
      }),
      closed: Deferred.await(entry.closed),
    });

    const opened = Effect.fnUntraced(function* (request: RequestId, credits: number) {
      const granted = Math.min(credits, limits.credits);
      const entry: Reader = {
        id: SubscriptionId.make(yield* Ref.updateAndGet(numbering, (held) => held + 1)),
        credit: yield* Semaphore.make(granted),
        granted,
        outstanding: yield* Ref.make(granted),
        closed: yield* Deferred.make<void>(),
      };
      const admitted = yield* Ref.modify(readers, (all): [boolean, ReadonlyMap<SubscriptionId, Reader>] =>
        all.size >= limits.subscriptions ? [false, all] : [true, new Map(all).set(entry.id, entry)],
      );
      if (!admitted) {
        yield* say({
          _tag: 'Fault',
          request,
          fault: { kind: 'subscriptions-exceeded', detail: `${limits.subscriptions} open` },
        });
        yield* withdraw(request);
        return undefined;
      }
      if (yield* answer(request)({ _tag: 'Subscribed', subscription: entry.id })) return subscription(entry);
      yield* release(entry.id);
      return undefined;
    });

    const welcome = Effect.fnUntraced(function* (request: RequestId, connection: ConnectionId, role: Role, version: number) {
      const standing = yield* custodian.current();
      return yield* say({
        _tag: 'Welcome',
        request,
        connection,
        role,
        installation: registration.installation,
        incarnation,
        phase: yield* admission.phase(),
        custody: standing._tag === 'Settled' ? standing.custody : standing.last,
        profile: capacity.profile,
        limits,
        capabilities: version === WIRE_VERSION ? [...served] : undefined,
      });
    });

    const opening = Effect.fnUntraced(function* (header: Uint8Array, payload: Uint8Array) {
      const read = clientOpening(chars.decode(header));
      switch (read._tag) {
        case 'Preface': {
          yield* preface;
          if (read.agreed === undefined) return yield* Effect.fail(new ConnectionOver({ detail: 'unsupported-version' }));
          return yield* Ref.set(dialect, read.agreed);
        }
        case 'Unsupported':
          return yield* fault(
            'unsupported-version',
            `the client speaks wire version ${read.version} and this host speaks ${rangeText(WIRE_RANGE)}`,
          );
        case 'Malformed':
          return yield* fault('malformed', 'the first frame is not a wire preface');
      }
    });

    const dispatch = Effect.fnUntraced(function* (header: Uint8Array, payload: Uint8Array): Effect.fn.Return<void, ConnectionOver> {
      const spoken = yield* Ref.get(dialect);
      if (spoken === undefined) return yield* opening(header, payload);
      const said = chars.decode(header);
      const unknown = Effect.fnUntraced(function* (value: unknown) {
        const found = unsupportedCall(value);
        if (found === undefined) return false;
        if ((yield* Ref.get(bound)) === undefined) yield* fault('unauthenticated', 'a call before hello');
        else yield* say({ _tag: 'Reply', request: found.request, body: { _tag: 'Refused', refusal: found.refusal } });
        return true;
      });
      const frame = yield* decodeClient(said).pipe(
        Effect.catchTag('SchemaError', (error) =>
          Effect.gen(function* () {
            const peer = peekWireVersion(said);
            if (peer === spoken && (yield* unknown(jsonOf(said)?.message))) return undefined;
            yield* peer === undefined || peer === spoken
              ? fault('malformed', error.message)
              : fault('unsupported-version', `the client sent wire version ${peer} on a connection that agreed ${spoken}`);
            return undefined;
          }),
        ),
      );
      if (frame === undefined) return;
      if (frame.v !== spoken) {
        return yield* fault('unsupported-version', `the client sent wire version ${frame.v} on a connection that agreed ${spoken}`);
      }
      const message =
        frame.body === 'bytes'
          ? frame.message
          : yield* decodeClientMessage(chars.decode(payload)).pipe(
              Effect.catchTag('SchemaError', (error) =>
                Effect.gen(function* () {
                  if (!(yield* unknown(jsonOf(chars.decode(payload))))) yield* fault('malformed', error.message);
                  return undefined;
                }),
              ),
            );
      if (message === undefined) return;
      yield* Effect.annotateCurrentSpan({ kind: message._tag });
      const standing = yield* Ref.get(bound);

      if (message._tag === 'Hello') {
        if (standing !== undefined) {
          return yield* fault('already-authenticated', 'this connection is already bound');
        }
        if (message.installation !== registration.installation) {
          return yield* fault('unsupported-family', 'another installation');
        }
        const role = yield* credentials.authenticate(message.role, message.secret).pipe(
          Effect.catchTags({
            CredentialRefused: () => Effect.succeed(undefined),
            CredentialsFailed: (failure) =>
              Effect.andThen(
                Effect.logError('the credential proof could not be evaluated', {
                  act: failure.act,
                  path: failure.path,
                  reason: failure.detail,
                }),
                Effect.fail(new ConnectionOver({ detail: 'credential-proof-unavailable' })),
              ),
          }),
        );
        if (role === undefined) {
          return yield* fault('unauthenticated', 'the presented secret is not this role');
        }
        if (provisional && role !== 'recovery') {
          yield* say({
            _tag: 'Fault',
            request: message.request,
            fault: { kind: 'connections-exceeded', detail: `${limits.connections} connections` },
          });
          return yield* Effect.fail(new ConnectionOver({ detail: 'connections-exceeded' }));
        }
        const id = ConnectionId.make(`${incarnation}:${yield* Effect.sync(() => crypto.randomUUID())}`);
        yield* Ref.set(bound, { connection: id, role });
        return yield* welcome(message.request, id, role, spoken);
      }

      if (standing === undefined) return yield* fault('unauthenticated', `${message._tag} before hello`);
      if (message._tag === 'Cancel') return yield* withdraw(message.request);
      if (message._tag === 'Unsubscribe') return yield* release(message.subscription);
      if (message._tag === 'Credit') {
        const entry = (yield* Ref.get(readers)).get(message.subscription);
        if (entry === undefined) return yield* fault('unknown-subscription', `${message.subscription}`);
        const standing = yield* Ref.get(entry.outstanding);
        if (standing + message.bytes > entry.granted) {
          yield* countCreditFault('credit-exceeded');
          return yield* fault('credit-exceeded', `${message.bytes} bytes returned against ${entry.granted - standing} outstanding`);
        }
        yield* Ref.update(entry.outstanding, (held) => held + message.bytes);
        return yield* Effect.asVoid(entry.credit.release(message.bytes));
      }

      if (message.installation !== registration.installation || message.incarnation !== incarnation) {
        return yield* fault('unsupported-family', 'another installation or generation', message.request);
      }
      const held = yield* Ref.get(inFlight);
      if (held.has(message.request)) return yield* fault('unknown-request', 'that number is already in flight');
      if (held.size >= limits.requests) {
        return yield* fault('requests-exceeded', `${limits.requests} in flight`, message.request);
      }
      yield* Ref.update(inFlight, (all) => new Set(all).add(message.request));
      const reply = answer(message.request);
      const floor = unsupported(message.body, servedOn(spoken, served));
      if (floor !== undefined) return yield* Effect.asVoid(reply({ _tag: 'Refused', refusal: floor }));
      if (yield* Ref.get(closed)) {
        return yield* Effect.asVoid(
          reply({ _tag: 'Refused', refusal: { _tag: 'AdmissionClosed', reason: 'this host is yielding its place to the next logic' } }),
        );
      }
      const parent = yield* Effect.currentParentSpan.pipe(Effect.catchTag('NoSuchElementError', () => Effect.succeed(undefined)));
      yield* Queue.offer(waiting, {
        connection: standing.connection,
        role: standing.role,
        epoch: message.epoch,
        request: message.request,
        body: message.body,
        payload: frame.body === 'bytes' ? payload : EMPTY_PAYLOAD,
        parent,
        reply,
        refuse: (refusal) => reply({ _tag: 'Refused', refusal }),
        subscribe: (credits) => (message.body._tag === 'Subscribe' ? opened(message.request, credits) : Effect.succeed(undefined)),
        hasSubscription: (id) => Effect.map(Ref.get(readers), (held) => held.has(id)),
      });
      yield* noteSendQueueDepth(Queue.sizeUnsafe(waiting));
    });

    const silence: Effect.Effect<boolean, never> = Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(limits.helloMs ?? 0));
      if ((yield* Ref.get(bound)) !== undefined) return false;
      yield* say({ _tag: 'Fault', fault: { kind: 'unauthenticated', detail: 'no hello within the grace window' } });
      return true;
    });

    const reading = Effect.scoped(
      Effect.flatMap(Socket.readerBytes(socket), (pull) =>
        Effect.forever(
          Effect.flatMap(pull, (batch) =>
            Effect.forEach(
              batch,
              (chunk) =>
                takeFrames(reader, chunk, (read) =>
                  read._tag === 'Fault'
                    ? fault(read.fault.kind, read.fault.detail)
                    : Effect.forEach(
                        read.frames,
                        (frame) =>
                          Effect.withSpan(dispatch(frame.header, frame.payload), WIRE_DISPATCH_SPAN, {
                            attributes: { bytes: frameSize(frame.header.length, frame.payload.length) },
                          }).pipe(
                            Effect.andThen(
                              frameSize(frame.header.length, frame.payload.length) >= YIELD_FRAME_BYTES ? Effect.yieldNow : Effect.void,
                            ),
                          ),
                        { discard: true },
                      ),
                ),
              { discard: true },
            ),
          ),
        ),
      ),
    );

    const watched = Effect.scoped(
      Effect.gen(function* () {
        const readingFiber = yield* Effect.forkScoped(reading);
        const watchFiber = yield* Effect.forkScoped(silence);
        const outcome = yield* Effect.raceFirst(
          Effect.as(Effect.exit(Fiber.join(readingFiber)), 'ended' as const),
          Effect.map(Fiber.join(watchFiber), (silent) => (silent ? ('silent' as const) : ('helloed' as const))),
        );
        if (outcome === 'silent') {
          yield* Fiber.interrupt(readingFiber);
          return yield* Effect.fail(new ConnectionOver({ detail: 'unauthenticated' }));
        }
        return yield* Fiber.join(readingFiber);
      }),
    );

    const released = Effect.flatMap(Ref.getAndSet(readers, new Map<SubscriptionId, Reader>()), (all) =>
      Effect.forEach(all.values(), (entry) => Deferred.succeed(entry.closed, undefined), { discard: true }),
    );

    const vacated = Effect.gen(function* () {
      const standing = yield* Ref.get(bound);
      if (standing === undefined) return;
      const outcome = yield* Effect.result(
        custodian.ended(
          {
            installation: registration.installation,
            operation: HostRequestKey.make(`custody-ended:${standing.connection}`),
          },
          standing.connection,
        ),
      );
      if (outcome._tag === 'Failure') yield* countRefusal(outcome.failure._tag);
    });

    yield* (limits.helloMs === undefined ? reading : watched).pipe(
      Effect.onExit((exit) =>
        Effect.andThen(released, Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? Effect.void : vacated),
      ),
    );
  });

  const serve = Effect.fnUntraced(
    function* (socket: Socket.Socket) {
      const send = yield* socket.writer;
      const dialect = yield* Ref.make<number | undefined>(undefined);
      const encoded = Effect.fnUntraced(function* (message: HostMessage, payload: Uint8Array): Effect.fn.Return<WriteFrame | undefined> {
        const version = (yield* Ref.get(dialect)) ?? WIRE_RANGE.min;
        const wide = yield* encodeHost({ v: version, body: 'bytes', message }).pipe(
          Effect.map((held) => text.encode(held)),
          Effect.catchTag('SchemaError', () => Effect.succeed(undefined)),
        );
        if (wide !== undefined && wide.length <= limits.headerBytes) return { header: wide, payload };
        if (payload.length > 0) return undefined;
        const narrow = yield* encodeHost({ v: version, body: 'json' }).pipe(
          Effect.map((held) => text.encode(held)),
          Effect.catchTag('SchemaError', () => Effect.succeed(undefined)),
        );
        const body = yield* encodeHostMessage(message).pipe(
          Effect.map((held) => text.encode(held)),
          Effect.catchTag('SchemaError', () => Effect.succeed(undefined)),
        );
        if (narrow === undefined || body === undefined) return undefined;
        return { header: narrow, payload: body };
      });
      const onto = (framed: WriteFrame): Effect.Effect<boolean> =>
        frameSize(framed.header.length, framed.payload.length) > limits.frameBytes
          ? Effect.succeed(false)
          : Effect.as(send.write(encodeFrame(framed.header, framed.payload)), true).pipe(
              Effect.catchTag('SocketError', () => Effect.succeed(false)),
            );
      const writer = yield* makeConnectionWriter({ write: onto, eventBytes: limits.frameBytes });
      const preface = onto({ header: PREFACE, payload: EMPTY_PAYLOAD });
      const write = (message: HostMessage, payload: Uint8Array): Effect.Effect<boolean> =>
        Effect.flatMap(encoded(message, payload), (framed) => {
          if (framed === undefined) return Effect.succeed(false);
          const cost = frameSize(framed.header.length, framed.payload.length);
          if (cost > limits.frameBytes) return Effect.succeed(false);
          return message._tag === 'Event' || message._tag === 'Fault'
            ? Effect.as(writer.event(framed, cost), true)
            : Effect.as(writer.reply(framed), true);
        });

      const seat = yield* Effect.acquireRelease(
        Effect.gen(function* () {
          if (yield* seats.takeIfAvailable(1)) return 'ordinary' as const;
          return (yield* spare.takeIfAvailable(1)) ? ('reserved' as const) : ('none' as const);
        }),
        (taken) =>
          taken === 'none'
            ? Effect.void
            : Effect.andThen(
                Effect.andThen(
                  taken === 'ordinary' ? seats.release(1) : spare.release(1),
                  Ref.update(live, (held) => held - 1),
                ),
                countSeatReclaimed(taken),
              ),
      );
      const reserved = seat === 'reserved';
      if (seat === 'none') {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* socket.reader;
            yield* write(
              { _tag: 'Fault', fault: { kind: 'connections-exceeded', detail: `${limits.connections} connections` } },
              EMPTY_PAYLOAD,
            );
          }),
        );
      }
      yield* Ref.update(live, (held) => held + 1);
      yield* connection(socket, write, encoded, (framed, cost) => writer.event(framed, cost), reserved, dialect, preface);
    },
    Effect.scoped,
    Effect.catchTag('ConnectionOver', () => Effect.void),
    Effect.catchTag('SocketError', () => Effect.void),
  );

  return HostConnections.of({
    open: Effect.uninterruptible(
      Effect.gen(function* () {
        if (yield* Ref.getAndSet(opened, true)) return;
        const loop = yield* Effect.forkIn(reportDeadFiber('accept', server.run(serve)), own);
        yield* Effect.forkDetach(
          Fiber.join(loop).pipe(
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.andThen(
                    Cause.hasFails(cause)
                      ? Effect.andThen(Effect.logError('host accept loop failed', cause), countFiberFailed('accept'))
                      : Effect.void,
                    Scope.close(own, Exit.failCause(cause)),
                  ),
            ),
          ),
        );
      }),
    ),
    close: Effect.gen(function* () {
      if (yield* Ref.getAndSet(closed, true)) return;
      const withdrawn = yield* Effect.result(endpoint.withdraw(registration));
      if (withdrawn._tag === 'Failure') yield* Effect.logWarning(`the endpoint ${path} stays named: ${withdrawn.failure.detail}`);
    }),
    descriptorReserve: () => Math.max(0, limits.connections + RECOVERY_SEATS - Ref.getUnsafe(live)) * endpoint.connectionExpense,
    admitted: Effect.tap(Queue.take(waiting), () => noteSendQueueDepth(Queue.sizeUnsafe(waiting))),
    endpoint: path,
    connections: Ref.get(live),
  });
});
