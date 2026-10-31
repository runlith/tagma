import { endpointConnection } from './posix/endpoint';
import { afterEach, describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Schema, Tracer } from 'effect';
import { ExecutionClient } from './ExecutionClient';
import { HostRegistration } from './HostRegistration';
import { Digest, rangeText } from './protocol/artifact';
import { HostRequestRef } from './protocol/execution';
import { LaunchRequest } from './protocol/launch';
import corpus from './protocol/wireCorpus.json';
import {
  WIRE_RANGE,
  WIRE_VERSION,
  PREVIOUS_RELEASE,
  WIRE_MAGIC,
  ClientFrame,
  ClientMessageText,
  HostFrame,
  type Request,
  type WireLimits,
} from './protocol/wire';
import { encodeFrame, EMPTY_PAYLOAD, frameReader } from './protocol/frames';
import { RegistrationIdentity } from './protocol/registration';
import { wireSession, type SessionFailure } from './WireSession';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const services = Layer.merge(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(platform));

const limits: WireLimits = { frameBytes: 65_536, headerBytes: 16_384, connections: 1, requests: 1, subscriptions: 1, credits: 65_536 };

const frame = (header: unknown, version: number = WIRE_VERSION): Uint8Array =>
  encodeFrame(new TextEncoder().encode(JSON.stringify({ v: version, body: 'bytes', message: header })), EMPTY_PAYLOAD);

const registered = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registrations = yield* HostRegistration;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'wire-session-' });
  const state = path.join(root, 'state');
  const identity = yield* Schema.decodeUnknownEffect(RegistrationIdentity)({
    installation: 'installation-1',
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: `${state}/host.sock` },
    credentials: { custodian: `${state}/custodian`, recovery: `${state}/recovery` },
  });
  const published = yield* registrations.publish(state, identity);
  const registration = published.registration;
  yield* fs.writeFileString(registration.credentials.custodian, `${'a'.repeat(43)}\n`, { mode: 0o600 });
  return { registration, address: { state: registration.state, installation: registration.installation } };
});

type Listener = ReturnType<typeof Bun.listen>;
const listeners: Listener[] = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.stop(true);
});

type Peer = { write: (bytes: Uint8Array) => number; end: () => void };

const listening = (path: string, greet: (socket: Peer) => void, ended?: () => void, heard?: (socket: Peer) => void) =>
  Effect.sync(() => {
    const listener = Bun.listen({
      unix: path,
      socket: {
        open: (socket) => greet(socket),
        data: (socket) => heard?.(socket),
        close: () => ended?.(),
      },
    });
    listeners.push(listener);
    return listener;
  });

const handshake = (address: { state: string; installation: string }) =>
  Effect.match(wireSession(address as never, 'custodian', limits, {}), {
    onFailure: (failure): SessionFailure | 'welcomed' => failure,
    onSuccess: (): SessionFailure | 'welcomed' => 'welcomed',
  });

const previousWelcome = corpus[PREVIOUS_RELEASE.version].frames.find((frame) => frame.header.includes('"Welcome"'))?.header ?? '';
const currentWelcome = corpus[WIRE_VERSION].frames.find((frame) => frame.header.includes('"Welcome"'))?.header ?? '';
const encodeHostFrame = Schema.encodeSync(Schema.fromJsonString(HostFrame));
const spoken = new TextEncoder();
const origin = { installation: 'installation-1', execution: 'execution-1', incarnation: 1 } as never;

const serving = (
  path: string,
  offered: { readonly min: number; readonly max: number },
  welcome: string,
  answered: (tag: string, body: Request) => unknown,
) => {
  const seen: Array<string> = [];
  const readers = new WeakMap<object, ReturnType<typeof frameReader>>();
  const say = (header: string) => encodeFrame(spoken.encode(header), EMPTY_PAYLOAD);
  const listener = Bun.listen({
    unix: path,
    socket: {
      open: () => {},
      data: (socket, chunk) => {
        const reader = readers.get(socket) ?? frameReader(limits);
        readers.set(socket, reader);
        const read = reader.push(chunk);
        if (read._tag === 'Fault') return;
        for (const frame of read.frames) {
          const parsed = JSON.parse(new TextDecoder().decode(frame.header));
          if (parsed.magic !== undefined) {
            socket.write(say(JSON.stringify({ magic: WIRE_MAGIC, wire: offered })));
            frame.release();
            continue;
          }
          const decoded = Schema.decodeUnknownSync(ClientFrame)(parsed);
          const message =
            decoded.body === 'bytes'
              ? decoded.message
              : Schema.decodeUnknownSync(ClientMessageText)(new TextDecoder().decode(frame.payload));
          if (message._tag === 'Hello') {
            seen.push('Hello');
            socket.write(say(welcome));
          } else if (message._tag === 'Call') {
            seen.push(message.body._tag);
            const body = answered(message.body._tag, message.body);
            if (body !== undefined) {
              socket.write(
                say(
                  encodeHostFrame({
                    v: parsed.v,
                    body: 'bytes',
                    message: { _tag: 'Reply', request: message.request, body },
                  } as never),
                ),
              );
            }
          }
          frame.release();
        }
      },
    },
  });
  listeners.push(listener);
  return seen;
};

const refusalOf = <A, E>(outcome: { readonly _tag: string; readonly failure?: E; readonly success?: A }) =>
  outcome._tag === 'Failure'
    ? (outcome.failure as { readonly _tag: string; readonly refusal?: { readonly _tag: string; readonly capability?: string } })
    : undefined;

layer(services, { excludeTestServices: true })('wire sessions', (it) => {
  describe('wireSession handshake', () => {
    it.effect('a selected bundle refuses a different host before reading its credential or connecting', () =>
      Effect.gen(function* () {
        for (const digest of [null, Digest.make(`sha256:${'b'.repeat(64)}`)]) {
          const { registration, address } = yield* registered;
          const files = yield* FileSystem.FileSystem;
          yield* files.remove(registration.credentials.custodian);
          yield* files.writeFileString(
            `${address.state}/registration.json`,
            JSON.stringify({
              ...registration,
              artifact: {
                identity: { digest: `sha256:${'a'.repeat(64)}`, build: 'standing' },
                protocol: 'executions/1',
                wire: WIRE_VERSION,
              },
            }),
          );
          const refused = yield* Effect.result(wireSession({ ...address, digest }, 'custodian', limits));
          expect(refused).toMatchObject({ _tag: 'Failure', failure: { _tag: 'WireUnavailable', kind: 'mismatched', sent: false } });
        }
      }),
    );

    it.effect('the connector refuses a registration transport it cannot serve', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        const files = yield* FileSystem.FileSystem;
        yield* files.writeFileString(
          `${registration.state}/registration.json`,
          JSON.stringify({
            ...registration,
            endpoint: { ...registration.endpoint, transport: 'named-pipe' },
          }),
        );
        const refused = yield* handshake(address);
        expect(refused).toMatchObject({ _tag: 'WireUnavailable', kind: 'invalid', sent: false });
        if (typeof refused !== 'string' && refused._tag === 'WireUnavailable') expect(refused.reason).toContain('named-pipe');
      }),
    );

    it.effect('a welcome this side cannot decode is a protocol failure, never unreachability', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        yield* listening(registration.endpoint.path, (socket) => {
          socket.write(
            frame({
              _tag: 'Welcome',
              request: 0,
              connection: 'c1',
              role: 'custodian',
              installation: 'installation-1',
              incarnation: 0,
              phase: 'open',
              custody: { revision: 0, epoch: 0 },
              profile: {},
              limits,
            }),
          );
        });
        const met = yield* handshake(address);
        expect(met).not.toBe('welcomed');
        if (met === 'welcomed') return;
        expect(met._tag).toBe('WireUnreadable');
        if (met._tag !== 'WireUnreadable') return;
        expect(met.detail).not.toContain('speaks wire version');
      }),
    );

    it.effect('a welcome of another wire names both versions, never this side’s expectation alone', () =>
      Effect.gen(function* () {
        for (const version of [WIRE_RANGE.min - 1, WIRE_VERSION + 1]) {
          const { registration, address } = yield* registered;
          yield* listening(
            registration.endpoint.path,
            () => {},
            undefined,
            (socket) => {
              socket.write(frame({ _tag: 'Event', body: { _tag: 'Ended', subscription: 1, ending: 'closed' } }, version));
              socket.end();
            },
          );
          const met = yield* handshake(address);
          expect(met).not.toBe('welcomed');
          if (met === 'welcomed') continue;
          expect(met._tag).toBe('WireUnreadable');
          if (met._tag !== 'WireUnreadable') continue;
          expect(met.detail).toContain(`wire version ${version}`);
          expect(met.detail).toContain(`speaks ${rangeText(WIRE_RANGE)}`);
        }
      }),
    );

    it.effect('each host frame is traced under the kind it carries, so frames are counted by kind', () => {
      const named: string[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          named.push(options.name);
          return new Tracer.NativeSpan(options);
        },
      });
      return Effect.gen(function* () {
        const { registration, address } = yield* registered;
        yield* listening(
          registration.endpoint.path,
          () => {},
          undefined,
          (socket) => {
            socket.write(frame({ _tag: 'Event', body: { _tag: 'Ended', subscription: 1, ending: 'closed' } }));
            socket.end();
          },
        );
        yield* handshake(address);
        expect(named).toContain('wire.read.dispatch.Event.Ended');
      }).pipe(Effect.withTracer(tracer));
    });

    it.effect('a fault sent before the welcome is the fault, not silence', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        yield* listening(
          registration.endpoint.path,
          () => {},
          undefined,
          (socket) => {
            socket.write(frame({ _tag: 'Fault', fault: { kind: 'malformed', detail: 'v: expected 1' } }));
            socket.end();
          },
        );
        const met = yield* handshake(address);
        expect(met).not.toBe('welcomed');
        if (met === 'welcomed') return;
        expect(met._tag).toBe('WireFailed');
        if (met._tag !== 'WireFailed') return;
        expect(met.fault.kind).toBe('malformed');
      }),
    );

    it.effect('a peer that accepts the socket and hangs up without a frame is there, and said nothing it should have', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        yield* listening(
          registration.endpoint.path,
          () => {},
          undefined,
          (socket) => socket.end(),
        );
        const met = yield* handshake(address);
        expect(met).not.toBe('welcomed');
        if (met === 'welcomed') return;
        expect(met._tag).toBe('WireUnavailable');
        if (met._tag !== 'WireUnavailable') return;
        expect(met.kind).toBe('invalid');
        expect(met.reason).toContain('before welcoming');
      }),
    );

    it.effect('a socket nothing listens on is unreachable, and that alone', () =>
      Effect.gen(function* () {
        const { address } = yield* registered;
        const met = yield* handshake(address);
        expect(met).not.toBe('welcomed');
        if (met === 'welcomed') return;
        expect(met._tag).toBe('WireUnavailable');
        if (met._tag !== 'WireUnavailable') return;
        expect(met.kind).toBe('unreachable');
      }),
    );

    it.effect('a connect interrupted before the client holds it closes the socket it opened', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        const accepted = yield* Deferred.make<void>();
        const gone = yield* Deferred.make<void>();
        yield* listening(
          registration.endpoint.path,
          () => Deferred.doneUnsafe(accepted, Effect.void),
          () => Deferred.doneUnsafe(gone, Effect.void),
        );
        const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
        const connecting = yield* Effect.forkChild(client.status());
        yield* Deferred.await(accepted);
        yield* Fiber.interrupt(connecting);
        yield* Deferred.await(gone);
      }),
    );
  });

  it.effect('large launch arguments cross the wire intact and an oversized frame is refused before sending', () =>
    Effect.gen(function* () {
      const command = `wc -c <<'EOF'\n${'x'.repeat(25_000)}\nEOF`;
      const received: string[][] = [];
      const { registration, address } = yield* registered;
      const operation = yield* Schema.decodeUnknownEffect(HostRequestRef)({
        installation: registration.installation,
        operation: 'heredoc',
      });
      const launch = yield* Schema.decodeUnknownEffect(LaunchRequest)({
        command: { program: '/bin/sh', args: ['-c', command], environment: [] },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        purpose: 'command',
        target: { environment: 'local', namespace: 'host', cwd: registration.state, dependencies: [] },
        holder: 'test',
        origin: 'test',
        lifetime: 'call',
      });
      const seen = serving(registration.endpoint.path, WIRE_RANGE, currentWelcome, (_, body) => {
        if (body._tag === 'Start') {
          received.push([...body.launch.command.args]);
          return { _tag: 'Start', outcome: { _tag: 'Cancelled', operation: body.operation } };
        }
        return { _tag: 'Refused', refusal: { _tag: 'HostUnavailable', reason: 'recorded' } };
      });
      const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
      const delivered = yield* Effect.result(client.start(operation, launch));
      const oversized = yield* Effect.result(
        client.start(operation, {
          ...launch,
          command: { ...launch.command, args: ['-c', 'x'.repeat(limits.frameBytes)] },
        }),
      );
      const status = yield* Effect.result(client.status());
      expect(delivered).toMatchObject({ _tag: 'Success', success: { _tag: 'Cancelled' } });
      expect(received).toEqual([['-c', command]]);
      expect(oversized).toMatchObject({ _tag: 'Failure', failure: { _tag: 'HostRefused', refusal: { _tag: 'CapacityExceeded' } } });
      expect(refusalOf(status)?.refusal?._tag).toBe('HostUnavailable');
      expect(seen).toEqual(['Hello', 'Start', 'Status']);
    }),
  );

  describe('a connection serves what its host announced', () => {
    const answering = (tag: string) =>
      tag === 'Subscribe'
        ? { _tag: 'Subscribed', subscription: 1 }
        : { _tag: 'Refused', refusal: { _tag: 'HostUnavailable', reason: 'recorded' } };

    it.effect('a host of the previous release is refused before hello because the wire has no common form', () =>
      Effect.gen(function* () {
        const { registration, address } = yield* registered;
        const seen = serving(
          registration.endpoint.path,
          { min: PREVIOUS_RELEASE.version, max: PREVIOUS_RELEASE.version },
          previousWelcome,
          answering,
        );
        const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
        const status = yield* Effect.result(client.status());
        expect(status).toMatchObject({ _tag: 'Failure', failure: { _tag: 'WireFailed', fault: { kind: 'unsupported-version' } } });
        expect(seen).toEqual([]);
      }),
    );

    it.effect('a host of this release that announces nothing is sent neither, and both are refused locally', () =>
      Effect.gen(function* () {
        const welcome = JSON.parse(currentWelcome);
        welcome.message.capabilities = [];
        const silent = JSON.stringify(welcome);
        const { registration, address } = yield* registered;
        const seen = serving(registration.endpoint.path, WIRE_RANGE, silent, answering);
        const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
        const load = yield* Effect.result(Effect.scoped(client.load(42, [])));
        const residual = yield* Effect.result(client.endResidual(origin, 4242));
        const status = yield* Effect.result(client.status());
        const foreground = yield* client.foreground(origin);
        expect(refusalOf(load)?.refusal).toMatchObject({ _tag: 'UnsupportedCapability', capability: 'machine-load' });
        expect(refusalOf(residual)?.refusal).toMatchObject({ _tag: 'UnsupportedCapability', capability: 'end-residual' });
        expect(foreground).toMatchObject({ _tag: 'ForegroundRefused', reason: 'unsupported' });
        expect(refusalOf(status)?.refusal?._tag).toBe('HostUnavailable');
        expect(seen).toEqual(['Hello', 'Status']);
      }),
    );

    it.effect('an older host announcing machine load is refused before the revised request is sent', () =>
      Effect.gen(function* () {
        const welcome = JSON.parse(currentWelcome);
        welcome.message.capabilities = ['machine-load'];
        const { registration, address } = yield* registered;
        const seen = serving(registration.endpoint.path, WIRE_RANGE, JSON.stringify(welcome), answering);
        const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
        const load = yield* Effect.result(Effect.scoped(client.load(42, [])));
        expect(refusalOf(load)?.refusal).toMatchObject({ _tag: 'UnsupportedCapability', capability: 'machine-load' });
        expect(seen).toEqual(['Hello']);
      }),
    );

    it.effect('a host that announces one capability is sent what needs it and refused locally the one it did not announce', () =>
      Effect.gen(function* () {
        const welcome = JSON.parse(currentWelcome);
        welcome.message.capabilities = ['machine-load', 'machine-load-parts'];
        const announced = JSON.stringify(welcome);
        const { registration, address } = yield* registered;
        const seen = serving(registration.endpoint.path, WIRE_RANGE, announced, answering);
        const client = yield* ExecutionClient.make({ address, role: 'custodian', limits });
        const residual = yield* Effect.result(client.endResidual(origin, 4242));
        const load = yield* Effect.result(Effect.scoped(client.load(42, [])));
        expect(refusalOf(residual)?.refusal).toMatchObject({ _tag: 'UnsupportedCapability', capability: 'end-residual' });
        expect(load._tag).toBe('Success');
        expect(seen).toEqual(['Hello', 'Subscribe']);
      }),
    );
  });
});
