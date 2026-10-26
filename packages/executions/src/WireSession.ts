import { Cause, Deferred, Duration, Effect, type Exit, FileSystem, Option, type PlatformError, Ref, Schema, type Scope } from 'effect';
import * as Socket from 'effect/socket/Socket';
import { EndpointConnection } from './EndpointConnection';
import { HostRefused, WireLost, WireFailed, WireInvalid, WireUnreadable, WireUnavailable, type Unavailability } from './Executions';
import type { ExecutionFeedItem } from './Executions';
import type { HostAddress } from './hostAddress';
import { HostRegistration } from './HostRegistration';
import { highestCommon } from './protocol/artifact';
import { announced, type Served } from './protocol/capability';
import type { CustodianEpoch, Registration, Role } from './protocol/registration';
import {
  ClientFrame,
  type ClientMessage,
  ClientMessageText,
  Event,
  fatalFault,
  frameSize,
  HostFrame,
  HostMessage,
  type Request,
  type RequestId,
  HostAnswer,
  servedOn,
  singleWire,
  type SubscriptionId,
  unknownEvent,
  unsupported,
  WIRE_MAGIC,
  WIRE_RANGE,
  type WireLimits,
  WirePreface,
  wireSkewDetail,
  wireVersionOf,
} from './protocol/wire';
import { EMPTY_PAYLOAD, encodeFrame, frameReader, takeFrames, WIRE_DISPATCH_SPAN, YIELD_FRAME_BYTES } from './protocol/frames';
import { type WireReaders, wireReaders } from './WireReaders';
import { type WireRequests, wireRequests } from './WireRequests';

export type Welcome = Extract<HostMessage, { readonly _tag: 'Welcome' }>;

export type WireSession = {
  readonly version: number;
  readonly served: Served;
  readonly welcome: Welcome;
  readonly requests: WireRequests;
  readonly readers: WireReaders;
  readonly epoch: Ref.Ref<CustodianEpoch>;
  readonly limits: WireLimits;
  readonly call: (request: RequestId, body: Request, payload: Uint8Array) => Effect.Effect<void, WireLost | WireInvalid | HostRefused>;
  readonly cancel: (request: RequestId) => Effect.Effect<void>;
  readonly credit: (subscription: SubscriptionId, bytes: number) => Effect.Effect<void>;
  readonly unsubscribe: (subscription: SubscriptionId) => Effect.Effect<void>;
  readonly alive: Effect.Effect<boolean>;
};

export type SessionFailure = WireUnavailable | WireFailed | WireInvalid | WireUnreadable | HostRefused;

export type SessionBudget = {
  readonly handshakeMs?: number;
  readonly controlRequests?: number;
};

const unavailable = (kind: Unavailability, reason: string) => Effect.fail(new WireUnavailable({ kind, reason, sent: false }));

const handshakeEnding = (exit: Exit.Exit<void, SessionFailure | WireLost>): SessionFailure => {
  if (exit._tag === 'Failure') {
    const failure = Cause.findErrorOption(exit.cause);
    if (Option.isSome(failure)) {
      const error = failure.value;
      return error._tag === 'WireLost'
        ? new WireUnavailable({
            kind: 'invalid',
            reason: `the host ended the connection before welcoming it: ${error.reason}`,
            sent: false,
          })
        : error;
    }
  }
  return new WireUnavailable({ kind: 'invalid', reason: 'the host closed the connection before welcoming it', sent: false });
};

const inside = (files: FileSystem.FileSystem, state: string, named: string): Effect.Effect<boolean> => {
  const cut = named.lastIndexOf('/');
  const leaf = named.slice(cut + 1);
  if (cut < 0 || leaf.length === 0 || leaf === '.' || leaf === '..') return Effect.succeed(false);
  const root = state.endsWith('/') ? state : `${state}/`;
  return files.realPath(named.slice(0, cut) || '/').pipe(
    Effect.map((parent) => parent === state || parent.startsWith(root)),
    Effect.catchTag('PlatformError', () => Effect.succeed(false)),
  );
};

const encodeClient = Schema.encodeUnknownEffect(Schema.fromJsonString(ClientFrame));
const encodeClientMessage = Schema.encodeUnknownEffect(ClientMessageText);
const decodeHost = Schema.decodeUnknownEffect(HostFrame);
const decodeHostMessage = Schema.decodeUnknownEffect(HostMessage);
const readPreface = Schema.decodeUnknownOption(WirePreface);
const text = new TextEncoder();
const chars = new TextDecoder();
const PREFACE = encodeFrame(
  text.encode(Schema.encodeSync(Schema.fromJsonString(WirePreface))({ magic: WIRE_MAGIC, wire: WIRE_RANGE })),
  EMPTY_PAYLOAD,
);

type Parsed = { readonly _tag: 'Parsed'; readonly value: unknown } | { readonly _tag: 'Unparsed'; readonly detail: string };

const parsed = (json: string): Parsed => {
  try {
    return { _tag: 'Parsed', value: JSON.parse(json) };
  } catch (cause) {
    return { _tag: 'Unparsed', detail: cause instanceof Error ? cause.message : String(cause) };
  }
};

const tagOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? (value as { readonly _tag?: unknown })._tag : undefined;

const REPLIES: ReadonlySet<unknown> = new Set(Object.keys(HostAnswer.cases));
const EVENTS: ReadonlySet<unknown> = new Set(Object.keys(Event.cases));

const kindOf = (message: unknown): string | undefined => {
  const tag = tagOf(message);
  if (tag === 'Welcome' || tag === 'Fault') return tag;
  if (tag !== 'Reply' && tag !== 'Event') return undefined;
  const body = tagOf((message as { readonly body?: unknown }).body);
  return (tag === 'Reply' ? REPLIES : EVENTS).has(body) ? `${tag}.${body as string}` : undefined;
};

const socketCause = (cause: unknown): string => (cause instanceof Error ? cause.message : 'an unknown socket cause');

const socketReason = (error: Socket.SocketError): string => {
  const reason = error.reason;
  switch (reason._tag) {
    case 'SocketCloseError':
      return `the socket closed: ${reason.code}${reason.closeReason === undefined ? '' : ` ${reason.closeReason}`}`;
    case 'SocketOpenError':
      return `the socket could not be opened (${reason.kind}): ${socketCause(reason.cause)}`;
    case 'SocketReadError':
      return `the socket read failed: ${socketCause(reason.cause)}`;
    case 'SocketWriteError':
      return `the socket write failed: ${socketCause(reason.cause)}`;
    case 'SocketUpgradeError':
      return `the socket TLS upgrade failed: ${socketCause(reason.cause)}`;
  }
};

const smaller = (a: WireLimits, b: WireLimits): WireLimits => ({
  frameBytes: Math.min(a.frameBytes, b.frameBytes),
  headerBytes: Math.min(a.headerBytes, b.headerBytes),
  connections: a.connections,
  requests: Math.min(a.requests, b.requests),
  subscriptions: Math.min(a.subscriptions, b.subscriptions),
  credits: Math.min(a.credits, b.credits),
});

const framed = Effect.fnUntraced(function* (message: ClientMessage, payload: Uint8Array, limits: WireLimits, version: number) {
  const encoded = yield* encodeClient({ v: version, body: 'bytes', message }).pipe(
    Effect.catchTag('SchemaError', (error) => Effect.fail(new WireInvalid({ detail: error.message }))),
  );
  let header = text.encode(encoded);
  let body = payload;
  if (header.length > limits.headerBytes && payload.length === 0) {
    header = text.encode(
      yield* encodeClient({ v: version, body: 'json' }).pipe(
        Effect.catchTag('SchemaError', (error) => Effect.fail(new WireInvalid({ detail: error.message }))),
      ),
    );
    body = text.encode(
      yield* encodeClientMessage(message).pipe(
        Effect.catchTag('SchemaError', (error) => Effect.fail(new WireInvalid({ detail: error.message }))),
      ),
    );
  }
  const size = frameSize(header.length, body.length);
  if (size > limits.frameBytes) {
    return yield* Effect.fail(
      new HostRefused({
        refusal: {
          _tag: 'CapacityExceeded',
          reason: `a ${message._tag} frame of ${size} bytes exceeds the ${limits.frameBytes} byte ceiling`,
        },
      }),
    );
  }
  if (header.length > limits.headerBytes) {
    return yield* Effect.fail(
      new HostRefused({
        refusal: {
          _tag: 'CapacityExceeded',
          reason: `a ${message._tag} header of ${header.length} bytes exceeds the ${limits.headerBytes} byte envelope`,
        },
      }),
    );
  }
  return encodeFrame(header, body);
});

export const wireSession = Effect.fn('executions.wireSession')(function* (
  address: HostAddress,
  role: Role,
  limits: WireLimits,
  budget: SessionBudget = {},
) {
  const files = yield* FileSystem.FileSystem;
  const registrations = yield* HostRegistration;
  const connection = yield* EndpointConnection;

  const registration = yield* registrations.read(address.state).pipe(
    Effect.catchTags({
      RegistrationMissing: () => unavailable('absent', `no registration stands in ${address.state}`),
      RegistrationInvalid: (error) =>
        error.reason === 'mismatch'
          ? unavailable('mismatched', `the registration names ${error.named}`)
          : unavailable('invalid', error.detail),
      RegistrationFailed: (error) => unavailable('invalid', `${error.act}: ${error.detail}`),
    }),
  );
  if (registration.installation !== address.installation) {
    return yield* unavailable('mismatched', `the registration belongs to installation ${registration.installation}`);
  }
  if (address.digest !== undefined && (address.digest === null || registration.artifact?.identity.digest !== address.digest)) {
    return yield* unavailable('mismatched', 'the registration does not name the offered bundle');
  }
  if (!(yield* inside(files, registration.state, registration.credentials[role]))) {
    return yield* unavailable('invalid', `the ${role} credential is named outside the state directory: ${registration.credentials[role]}`);
  }

  const secret = yield* files.readFileString(registration.credentials[role]).pipe(
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
      unavailable('credential', `the ${role} credential is unreadable: ${error.reason._tag}`),
    ),
    Effect.map((held) => held.trimEnd()),
  );

  const arrived = yield* Deferred.make<WireSession, SessionFailure>();
  yield* Effect.addFinalizer(() =>
    Deferred.fail(
      arrived,
      new WireUnavailable({ kind: 'unreachable', reason: 'the connection scope closed before the host welcomed it', sent: false }),
    ),
  );
  const settled = yield* Ref.make<WireSession | undefined>(undefined);
  const closed = yield* Ref.make(false);

  yield* Effect.forkScoped(
    run(connection, registration, role, secret, limits, budget.controlRequests ?? 0, arrived, settled, closed).pipe(
      Effect.catchTag('SocketError', (error) =>
        Effect.flatMap(Ref.get(settled), (session) =>
          Effect.fail(
            session !== undefined
              ? new WireLost({ reason: socketReason(error), sent: true })
              : error.reason._tag === 'SocketOpenError'
                ? new WireUnavailable({ kind: 'unreachable', reason: socketReason(error), sent: false })
                : new WireUnavailable({
                    kind: 'invalid',
                    reason: `the host ended the connection before welcoming it: ${socketReason(error)}`,
                    sent: false,
                  }),
          ),
        ),
      ),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          yield* Ref.set(closed, true);
          yield* Deferred.fail(arrived, handshakeEnding(exit));
          const session = yield* Ref.get(settled);
          if (session === undefined) return;
          yield* session.requests.closeAll('the connection ended');
          yield* session.readers.closeAll('closed');
        }),
      ),
    ),
  );

  const welcome = Deferred.await(arrived);
  return yield* budget.handshakeMs === undefined
    ? welcome
    : Effect.timeoutOrElse(welcome, {
        duration: Duration.millis(budget.handshakeMs),
        orElse: () =>
          Effect.fail(
            new WireUnreadable({
              detail: `the host accepted this connection and did not welcome it within ${budget.handshakeMs}ms`,
            }),
          ),
      });
});

const run = Effect.fnUntraced(function* (
  connection: EndpointConnection['Service'],
  registration: Registration,
  role: Role,
  secret: string,
  limits: WireLimits,
  controlRequests: number,
  arrived: Deferred.Deferred<WireSession, SessionFailure>,
  settled: Ref.Ref<WireSession | undefined>,
  closed: Ref.Ref<boolean>,
) {
  const socket = yield* connection.connect(registration);
  const send = yield* socket.writer;
  const reader = frameReader(limits);
  const dialect = yield* Ref.make<number | undefined>(undefined);

  const write = (frame: Uint8Array) =>
    send
      .write(frame)
      .pipe(Effect.catchTag('SocketError', (error) => Effect.fail(new WireLost({ reason: socketReason(error), sent: true }))));

  const say = (message: ClientMessage, payload: Uint8Array, limits: WireLimits, version: number) =>
    Effect.flatMap(framed(message, payload, limits, version), write);

  const hello = (version: number) =>
    say(
      {
        _tag: 'Hello',
        request: 0 as RequestId,
        installation: registration.installation,
        protocol: registration.protocol,
        role,
        secret,
        client: { name: '@runlith/executions', version: `${version}` },
      },
      EMPTY_PAYLOAD,
      limits,
      version,
    );

  const refused = (fault: WireFailed['fault']) =>
    Effect.andThen(Deferred.fail(arrived, new WireFailed({ fault })), Effect.fail(new WireFailed({ fault })));

  const negotiating = Effect.fnUntraced(function* (peer: number | undefined, value: unknown) {
    const preface = readPreface(value);
    if (preface._tag === 'Some') {
      const agreed = highestCommon(WIRE_RANGE, preface.value.wire);
      if (agreed === undefined) {
        return yield* refused({ kind: 'unsupported-version', detail: wireSkewDetail(preface.value.wire, WIRE_RANGE) });
      }
      yield* Ref.set(dialect, agreed);
      return yield* hello(agreed);
    }
    if (peer === undefined || peer < WIRE_RANGE.min || peer > WIRE_RANGE.max) {
      return yield* Effect.fail(
        new WireUnreadable({
          detail:
            peer === undefined ? 'the host answered with a frame that is no wire preface' : wireSkewDetail(singleWire(peer), WIRE_RANGE),
        }),
      );
    }
    const frame = yield* decodeHost(value).pipe(
      Effect.catchTag('SchemaError', (error) => Effect.fail(new WireUnreadable({ detail: error.message }))),
    );
    if (frame.body === 'bytes' && frame.message._tag === 'Fault') return yield* refused(frame.message.fault);
    return yield* Effect.fail(
      new WireUnreadable({
        detail: `the host sent ${frame.body === 'bytes' ? frame.message._tag : 'a payload'} before its wire preface`,
      }),
    );
  });

  const welcomed = Effect.fnUntraced(function* (message: Welcome, version: number) {
    if (yield* Effect.map(Ref.get(settled), (held) => held !== undefined)) {
      return yield* Effect.fail(new WireUnreadable({ detail: 'the host welcomed this connection twice' }));
    }
    if (message.installation !== registration.installation) {
      return yield* Effect.fail(new WireUnreadable({ detail: `the host answered for installation ${message.installation}` }));
    }
    if (message.role !== role) {
      return yield* Effect.fail(new WireUnreadable({ detail: `the host bound the role ${message.role}` }));
    }
    const effective = smaller(limits, message.limits);
    const served = servedOn(version, announced(message.capabilities));
    const session: WireSession = {
      version,
      served,
      welcome: message,
      requests: yield* wireRequests(effective.requests, controlRequests),
      readers: yield* wireReaders(effective.subscriptions),
      epoch: yield* Ref.make(message.custody.epoch),
      limits: effective,
      call: Effect.fnUntraced(function* (request, body, payload) {
        const refusal = unsupported(body, served);
        if (refusal !== undefined) return yield* Effect.fail(new HostRefused({ refusal }));
        const epoch = yield* Ref.get(session.epoch);
        return yield* say(
          {
            _tag: 'Call',
            request,
            installation: registration.installation,
            incarnation: message.incarnation,
            epoch,
            body,
          },
          payload,
          effective,
          version,
        );
      }),
      cancel: (request) => Effect.ignore(say({ _tag: 'Cancel', request }, EMPTY_PAYLOAD, effective, version)),
      credit: (subscription, bytes) => Effect.ignore(say({ _tag: 'Credit', subscription, bytes }, EMPTY_PAYLOAD, effective, version)),
      unsubscribe: (subscription) =>
        Effect.flatMap(Ref.get(closed), (ended) =>
          ended
            ? Effect.void
            : Effect.ignore(
                say({ _tag: 'Unsubscribe', subscription }, EMPTY_PAYLOAD, effective, version).pipe(
                  Effect.tapError((failure) =>
                    Effect.logWarning('Execution subscription release could not be sent', { subscription, failure }),
                  ),
                  Effect.timeoutOrElse({
                    duration: Duration.millis(2_000),
                    orElse: () =>
                      Effect.logWarning('Execution subscription release was not sent before its cleanup deadline', { subscription }),
                  }),
                ),
              ),
        ),
      alive: Effect.map(Ref.get(closed), (ended) => !ended),
    };
    yield* Ref.set(settled, session);
    yield* Deferred.succeed(arrived, session);
  });

  const delivered = (session: WireSession, subscription: SubscriptionId, delivery: ExecutionFeedItem, cost: number) =>
    Effect.flatMap(session.readers.deliver(subscription, delivery, cost), (outcome) =>
      outcome === 'overdrawn'
        ? Effect.fail(new WireUnreadable({ detail: `the host delivered past the credit granted to ${subscription}` }))
        : Effect.void,
    );

  const passed = Effect.fnUntraced(function* (subscription: SubscriptionId, cost: number) {
    const session = yield* Ref.get(settled);
    if (session === undefined) {
      return yield* Effect.fail(new WireUnreadable({ detail: 'the host sent an event before welcoming' }));
    }
    if (yield* session.readers.grant(subscription, 0)) yield* session.credit(subscription, cost);
  });

  const dispatch = (header: Uint8Array, payload: Uint8Array) =>
    Effect.suspend(() => {
      const text = chars.decode(header);
      const read = parsed(text);
      const outer =
        read._tag === 'Parsed' && typeof read.value === 'object' && read.value !== null
          ? (read.value as { readonly body?: unknown; readonly message?: unknown })
          : undefined;
      const inner: Parsed = outer?.body === 'json' ? parsed(chars.decode(payload)) : { _tag: 'Parsed', value: outer?.message };
      const kind = inner._tag === 'Parsed' ? kindOf(inner.value) : undefined;
      return Effect.withSpan(
        handled(read, inner, header, payload),
        kind === undefined ? WIRE_DISPATCH_SPAN : `${WIRE_DISPATCH_SPAN}.${kind}`,
        { attributes: { bytes: frameSize(header.length, payload.length), kind: kind } },
      );
    });

  const handled = Effect.fnUntraced(function* (read: Parsed, inner: Parsed, header: Uint8Array, payload: Uint8Array) {
    if (read._tag === 'Unparsed') return yield* Effect.fail(new WireUnreadable({ detail: read.detail }));
    const version = yield* Ref.get(dialect);
    const peer = wireVersionOf(read.value);
    if (version === undefined) return yield* negotiating(peer, read.value);
    const passing = inner._tag === 'Parsed' && peer === version ? unknownEvent(inner.value) : undefined;
    if (passing !== undefined) return yield* passed(passing, frameSize(header.length, payload.length));
    if (peer !== undefined && peer !== version) {
      return yield* Effect.fail(new WireUnreadable({ detail: wireSkewDetail(singleWire(peer), singleWire(version)) }));
    }
    const frame = yield* decodeHost(read.value).pipe(
      Effect.catchTag('SchemaError', (error) => Effect.fail(new WireUnreadable({ detail: error.message }))),
    );
    const message =
      frame.body === 'bytes'
        ? frame.message
        : inner._tag === 'Unparsed'
          ? yield* Effect.fail(new WireUnreadable({ detail: inner.detail }))
          : yield* decodeHostMessage(inner.value).pipe(
              Effect.catchTag('SchemaError', (error) => Effect.fail(new WireUnreadable({ detail: error.message }))),
            );
    if (message._tag === 'Welcome') return yield* welcomed(message, version);

    const session = yield* Ref.get(settled);
    if (session === undefined) {
      if (message._tag === 'Fault') return yield* refused(message.fault);
      return yield* Effect.fail(new WireUnreadable({ detail: `the host sent ${message._tag} before welcoming` }));
    }

    if (message._tag === 'Reply') {
      if (message.body._tag === 'Subscribed') {
        if (!(yield* session.readers.bind(message.request, message.body.subscription))) {
          yield* session.unsubscribe(message.body.subscription);
        }
      }
      if (message.body._tag === 'Read' && payload.length !== message.body.bytes) {
        return yield* Effect.fail(new WireUnreadable({ detail: `a read named ${message.body.bytes} bytes and carried ${payload.length}` }));
      }
      return yield* session.requests.settle(message.request, message.body, payload);
    }

    if (message._tag === 'Event') {
      const body = message.body;
      const cost = frameSize(header.length, payload.length);
      if (body._tag === 'Ended') return yield* session.readers.end(body.subscription, body.ending);
      if (body._tag === 'Bytes') {
        if (payload.length !== body.bytes) {
          return yield* Effect.fail(new WireUnreadable({ detail: `a delivery named ${body.bytes} bytes and carried ${payload.length}` }));
        }
        return yield* delivered(session, body.subscription, { _tag: 'Bytes', range: body.range, bytes: payload }, cost);
      }
      if (body._tag === 'State') {
        return yield* delivered(session, body.subscription, { _tag: 'State', summary: body.summary }, cost);
      }
      if (body._tag === 'Inventory') {
        return yield* delivered(session, body.subscription, { _tag: 'Inventory', update: body.update }, cost);
      }
      if (body._tag === 'Load') {
        return yield* delivered(session, body.subscription, { _tag: 'Load', reading: body.reading }, cost);
      }
      return yield* delivered(session, body.subscription, { _tag: 'Screen', update: body.update }, cost);
    }

    if (fatalFault(message.fault)) return yield* Effect.fail(new WireFailed({ fault: message.fault }));
    if (message.request !== undefined) return yield* session.requests.fault(message.request, message.fault);
    return;
  });

  const pull = yield* Socket.readerBytes(socket);
  yield* write(PREFACE).pipe(
    Effect.catchTag('WireLost', (lost) =>
      Deferred.fail(arrived, new WireUnavailable({ kind: 'unreachable', reason: lost.reason, sent: false })),
    ),
  );
  return yield* Effect.forever(
    Effect.flatMap(pull, (batch) =>
      Effect.forEach(
        batch,
        (chunk) =>
          takeFrames(reader, chunk, (read) =>
            read._tag === 'Fault'
              ? Effect.fail(new WireUnreadable({ detail: `${read.fault.kind}: ${read.fault.detail}` }))
              : Effect.forEach(
                  read.frames,
                  (frame) =>
                    dispatch(frame.header, frame.payload).pipe(
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
  );
}, Effect.scoped);
