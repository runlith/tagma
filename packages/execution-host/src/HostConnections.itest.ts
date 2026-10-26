import { fixtureHolder } from './hostFixture';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { credentialsLayer } from './posix/credentials';
import { endpointLayer } from './posix/endpoint';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Crypto, Data, Deferred, Effect, Fiber, FileSystem, Layer, PlatformError, Ref, Schema, type Scope, Stream } from 'effect';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import { join } from 'node:path';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import type { Registration, Role } from '@runlith/executions/protocol/registration';
import { CAPABILITIES } from '@runlith/executions/protocol/capability';
import { HostFrame, WIRE_MAGIC, WIRE_RANGE, WIRE_VERSION, type WireLimits } from '@runlith/executions/protocol/wire';
import { EMPTY_PAYLOAD, encodeFrame, frameReader } from '@runlith/executions/protocol/frames';
import { ConnectionId } from '@runlith/executions/protocol/registration';
import { Credentials } from './Credentials';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionStore } from './store/ExecutionStore';
import { type Admitted, HostConnections } from './HostConnections';
import * as BunServices from '@effect/platform-bun/BunServices';
import { hostProfile, INSTALLATION, keyOf, registrationOf, stateDirectories } from './hostFixture';
import { hostState } from './hostState';

const directories = stateDirectories('host-connections-');
afterAll(directories.clear);

const profile = hostProfile();

const limits: WireLimits = {
  frameBytes: 4096,
  headerBytes: 4096,
  connections: 2,
  requests: 2,
  subscriptions: 2,
  credits: 4096 * 4,
};

const clientLimits: WireLimits = { ...limits, connections: 1 };

const cursorAt = (registration: Registration, execution: string, from: bigint) => ({
  ref: { installation: registration.installation, execution: ExecutionId.make(execution), incarnation: 1 },
  stream: 'stdout' as const,
  offset: byteOffset(from),
});

const range = (registration: Registration, execution: string, from: bigint, through: bigint) => ({
  cursor: cursorAt(registration, execution, from),
  next: byteOffset(through),
  retainedFrom: byteOffset(0n),
  durableThrough: byteOffset(through),
  gap: false,
});

const endpoint = Effect.fnUntraced(function* (directory: string, wire: WireLimits = limits) {
  const registrations = yield* HostRegistration;
  const offered = registrationOf(directory);
  const published = yield* registrations.publish(directory, {
    installation: offered.installation,
    protocol: offered.protocol,
    endpoint: offered.endpoint,
    credentials: offered.credentials,
  });
  const registration = published.registration;
  const state = hostState(join(registration.state, 'executions.sqlite'), registration, yield* sharedPool).pipe(
    Layer.provide(fixtureHolder()),
    Layer.provideMerge(ExecutionCapacity.layer(profile)),
  );
  const entered = yield* Effect.provide(
    Effect.flatMap(ExecutionStore, (store) => store.incarnation()),
    state,
  );
  const connections = HostConnections.layer(registration, entered.incarnation, wire, CAPABILITIES).pipe(
    Layer.provide(credentialsLayer(registration.credentials)),
    Layer.provide(endpointLayer),
    Layer.provideMerge(state),
  );
  return { registration, connections } as const;
});

const answering = (connections: HostConnections['Service'], answer: (admitted: Admitted) => Effect.Effect<void, never, Scope.Scope>) =>
  Effect.forkScoped(Effect.forever(Effect.flatMap(connections.admitted, (admitted) => Effect.forkScoped(answer(admitted)))));

const client = (registration: Registration, role: Role) =>
  ExecutionClient.make({ address: { state: registration.state, installation: registration.installation }, role, limits: clientLimits });

const over = Effect.fnUntraced(function* <A, E>(
  directory: string,
  work: (
    registration: Registration,
    connections: HostConnections['Service'],
  ) => Effect.Effect<A, E, HostRegistration | EndpointConnection | FileSystem.FileSystem | Scope.Scope | Custodian>,
  wire: WireLimits = limits,
) {
  const built = yield* endpoint(directory, wire);
  return yield* Effect.provide(
    Effect.flatMap(HostConnections, (connections) => Effect.andThen(connections.open, work(built.registration, connections))),
    built.connections,
  );
}, Effect.scoped);

const platform = Layer.merge(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

const status = (registration: Registration): RuntimeStatus => ({
  installation: registration.installation,
  incarnation: 1,
  phase: 'open' as const,
  holder: { _tag: 'Standing' as const },
  custody: { revision: 0, epoch: 0 },
  executions: 0,
  memory: { granted: profile.granted, reserved: 0, retained: 0, executions: 0, ceiling: profile.ceilings.executions },
});

layer(platform, { excludeTestServices: true })('the execution wire, over a real endpoint', (it) => {
  it.effect('a secret that is not the registered one refuses the connection, and nothing is bound', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          yield* answering(connections, (admitted) => admitted.reply({ _tag: 'Status', status: status(registration) }));
          const files = yield* FileSystem.FileSystem;
          yield* files.writeFileString(registration.credentials.custodian, `${'A'.repeat(42)}A\n`);
          const executions = yield* client(registration, 'custodian');
          return yield* Effect.flip(executions.status());
        }),
      );

      expect(outcome._tag).toBe('WireFailed');
      if (outcome._tag !== 'WireFailed') return;
      expect(outcome.fault.kind).toBe('unauthenticated');
    }),
  );

  it.effect('an unavailable credential proof leaves hello unavailable rather than refusing a valid secret', () =>
    Effect.gen(function* () {
      const native = yield* Crypto.Crypto;
      let unavailable = false;
      const controlled: Crypto.Crypto = {
        ...native,
        digest: (algorithm, data) =>
          Effect.suspend(() =>
            unavailable
              ? Effect.fail(PlatformError.badArgument({ module: 'Crypto', method: 'digest', description: 'proof unavailable' }))
              : native.digest(algorithm, data),
          ),
      };
      const outcome = yield* over(directories.open(), (registration, connections) =>
        Effect.gen(function* () {
          yield* answering(connections, (admitted) => admitted.reply({ _tag: 'Status', status: status(registration) }));
          unavailable = true;
          const executions = yield* client(registration, 'custodian');
          return yield* Effect.flip(executions.status());
        }),
      ).pipe(Effect.provideService(Crypto.Crypto, controlled));
      expect(outcome._tag).toBe('WireUnavailable');
      if (outcome._tag === 'WireUnavailable') expect(outcome.sent).toBe(false);
    }),
  );

  it.effect('a closed host withdraws its endpoint and refuses the next request on a connection already open', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          yield* answering(connections, (admitted) => admitted.reply({ _tag: 'Status', status: status(registration) }));
          const executions = yield* client(registration, 'recovery');
          const before = yield* executions.status();
          yield* connections.close;
          const files = yield* FileSystem.FileSystem;
          return {
            before: before.phase,
            named: yield* files.exists(registration.endpoint.path),
            after: yield* Effect.flip(executions.status()),
          };
        }),
      );

      expect(outcome.before).toBe('open');
      expect(outcome.named).toBe(false);
      expect(outcome.after).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'AdmissionClosed' } });
    }),
  );

  it.effect('an address with no registration answers absent, and connects to nothing', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* Effect.gen(function* () {
        const executions = yield* ExecutionClient.make({
          address: { state: directory, installation: registrationOf(directory).installation },
          role: 'custodian',
          limits: clientLimits,
        });
        return yield* Effect.flip(executions.status());
      });

      expect(outcome._tag).toBe('WireUnavailable');
      if (outcome._tag !== 'WireUnavailable') return;
      expect(outcome.kind).toBe('absent');
    }),
  );

  it.effect('the request carries the connection the host bound and the role the secret matched', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const seen = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          const witnessed = yield* Deferred.make<{ readonly connection: string; readonly role: Role }>();
          yield* answering(connections, (admitted) =>
            Effect.andThen(
              Deferred.succeed(witnessed, { connection: admitted.connection, role: admitted.role }),
              admitted.reply({ _tag: 'Status', status: status(registration) }),
            ),
          );
          const executions = yield* client(registration, 'recovery');
          yield* executions.status();
          return yield* Deferred.await(witnessed);
        }),
      );

      expect(seen.connection.length).toBeGreaterThan(0);
      expect(seen.role).toBe('recovery');
    }),
  );

  it.effect('a JSON request reaches admission as its message with no binary input', () =>
    Effect.gen(function* () {
      const wire = { ...limits, frameBytes: 65_536 };
      const trigger = 'x'.repeat(25_000);
      const seen = yield* over(
        directories.open(),
        (registration, connections) =>
          Effect.gen(function* () {
            const witnessed = yield* Deferred.make<{ trigger: string; bytes: number }>();
            yield* answering(connections, (admitted) =>
              Effect.gen(function* () {
                if (admitted.body._tag !== 'CancelStart') return;
                yield* Deferred.succeed(witnessed, { trigger: admitted.body.trigger, bytes: admitted.payload.length });
                yield* admitted.reply({ _tag: 'CancelStart', outcome: { _tag: 'Prevented', operation: admitted.body.operation } });
              }),
            );
            const executions = yield* ExecutionClient.make({
              address: { state: registration.state, installation: registration.installation },
              role: 'custodian',
              limits: wire,
            });
            yield* executions.cancelStart(keyOf('json-request'), 'run-abort', trigger);
            return yield* Deferred.await(witnessed);
          }),
        wire,
      );
      expect(seen).toEqual({ trigger, bytes: 0 });
    }),
  );

  it.effect('a withdrawn request drops its answer and does not undo the work', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          const done = yield* Ref.make(0);
          const released = yield* Deferred.make<void>();
          const reached = yield* Deferred.make<void>();
          yield* answering(connections, (admitted) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(reached, undefined);
              yield* Deferred.await(released);
              yield* Ref.update(done, (held) => held + 1);
              yield* admitted.reply({ _tag: 'Status', status: status(registration) });
            }),
          );
          const executions = yield* client(registration, 'custodian');
          const asking = yield* Effect.forkChild(executions.status());
          yield* Deferred.await(reached);
          yield* Fiber.interrupt(asking);
          yield* Deferred.succeed(released, undefined);
          yield* executions.status();
          return yield* Ref.get(done);
        }),
      );

      expect(outcome).toBe(2);
    }),
  );

  it.effect('two readers hold their own positions and their own credit', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          const pushed = yield* Ref.make<ReadonlyArray<string>>([]);
          yield* answering(connections, (admitted) =>
            Effect.gen(function* () {
              if (admitted.body._tag !== 'Subscribe') return yield* admitted.reply({ _tag: 'Status', status: status(registration) });
              const source = admitted.body.source;
              const named = source._tag === 'Bytes' ? source.cursor.ref.execution : 'other';
              const subscription = yield* admitted.subscribe(admitted.body.credits);
              if (subscription === undefined) return;
              const from = source._tag === 'Bytes' ? offsetValue(source.cursor.offset) : 0n;
              for (let index = 0n; index < 4n; index += 1n) {
                const at = from + index;
                const sent = yield* subscription.bytes(range(registration, named, at, at + 1n), new Uint8Array([Number(at)]));
                if (!sent) return;
                yield* Ref.update(pushed, (held) => [...held, `${named}:${at}`]);
              }
              yield* subscription.end('completed');
            }),
          );
          const executions = yield* client(registration, 'custodian');
          const first = executions.subscribe({ _tag: 'Bytes', cursor: cursorAt(registration, 'shared', 0n) }, limits.credits);
          const second = executions.subscribe({ _tag: 'Bytes', cursor: cursorAt(registration, 'shared', 100n) }, limits.credits);
          const [one, two] = yield* Effect.all([Stream.runCollect(first), Stream.runCollect(second)], { concurrency: 2 });
          return { one, two, pushed: yield* Ref.get(pushed) };
        }),
      );

      const bytesOf = (deliveries: ReadonlyArray<ExecutionFeedItem>) =>
        deliveries.flatMap((delivery) => (delivery._tag === 'Bytes' ? [delivery.bytes[0]] : []));
      expect(bytesOf([...outcome.one])).toEqual([0, 1, 2, 3]);
      expect(bytesOf([...outcome.two])).toEqual([100, 101, 102, 103]);
      expect(outcome.one.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(outcome.two.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(outcome.pushed).toHaveLength(8);
    }),
  );

  it.effect('a reader that stops taking stops being sent to, and the host waits rather than queueing', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const attempts = 64;
      const sent = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          const completed = yield* Ref.make(0);
          const waiting = yield* Deferred.make<void>();
          const finished = yield* Deferred.make<void>();
          yield* answering(connections, (admitted) =>
            Effect.gen(function* () {
              if (admitted.body._tag !== 'Subscribe') {
                return yield* admitted.reply({ _tag: 'Status', status: status(registration) });
              }
              const subscription = yield* admitted.subscribe(admitted.body.credits);
              if (subscription === undefined) return;
              const payload = new Uint8Array(1024);
              for (let index = 0; index < attempts; index += 1) {
                yield* Deferred.succeed(waiting, undefined);
                const ok = yield* subscription.bytes(range(registration, 'held', 0n, 1024n), payload);
                if (!ok) return;
                yield* Ref.update(completed, (held) => held + 1);
              }
              yield* Deferred.succeed(finished, undefined);
            }),
          );
          const executions = yield* client(registration, 'custodian');
          const opened = yield* Effect.forkChild(
            Stream.runDrain(
              Stream.take(executions.subscribe({ _tag: 'Bytes', cursor: cursorAt(registration, 'held', 0n) }, limits.credits), 1),
            ),
          );
          yield* Fiber.await(opened);
          yield* Deferred.await(waiting);
          yield* executions.status();
          return { completed: yield* Ref.get(completed), done: yield* Deferred.isDone(finished) };
        }),
      );

      expect(sent.done).toBe(false);
      expect(sent.completed).toBeLessThan(attempts);
      expect(sent.completed).toBeGreaterThan(0);
    }),
  );

  it.effect('a reader granted exactly one frame receives delivery after delivery, one at a time', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const payload = new Uint8Array(3000).fill(7);
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          const pushed = yield* Ref.make(0);
          yield* answering(connections, (admitted) =>
            Effect.gen(function* () {
              if (admitted.body._tag !== 'Subscribe') {
                return yield* admitted.reply({ _tag: 'Status', status: status(registration) });
              }
              const subscription = yield* admitted.subscribe(admitted.body.credits);
              if (subscription === undefined) return;
              for (let index = 0; index < 3; index += 1) {
                const ok = yield* subscription.bytes(range(registration, 'held', 0n, 3000n), payload);
                if (!ok) return;
                yield* Ref.update(pushed, (held) => held + 1);
              }
              yield* subscription.end('completed');
            }),
          );
          const executions = yield* client(registration, 'custodian');
          const delivered = yield* Stream.runCollect(
            Stream.take(executions.subscribe({ _tag: 'Bytes', cursor: cursorAt(registration, 'held', 0n) }, limits.frameBytes), 3),
          );
          return { pushed: yield* Ref.get(pushed), delivered: delivered.length };
        }),
      );

      expect(outcome.pushed).toBe(3);
      expect(outcome.delivered).toBe(3);
    }),
  );

  it.effect('a connection past the endpoint count is told and closed, and the ones holding seats keep working', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const outcome = yield* over(directory, (registration, connections) =>
        Effect.gen(function* () {
          yield* answering(connections, (admitted) => admitted.reply({ _tag: 'Status', status: status(registration) }));
          const first = yield* client(registration, 'custodian');
          yield* first.status();
          const second = yield* client(registration, 'custodian');
          yield* second.status();
          const extra = yield* client(registration, 'custodian');
          const refused = yield* Effect.flip(extra.status());
          const after = yield* first.status();
          return { refused, after };
        }),
      );

      expect(outcome.refused._tag).toBe('WireFailed');
      if (outcome.refused._tag !== 'WireFailed') return;
      expect(outcome.refused.fault.kind).toBe('connections-exceeded');
      expect(String(outcome.after.installation)).toBe(INSTALLATION);
    }),
  );

  it.effect('a custodian that outlives the hello grace and then closes its socket has its custody vacated', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const helloMs = 50;
      const outcome = yield* over(
        directory,
        (registration, connections) =>
          Effect.gen(function* () {
            const custodian = yield* Custodian;
            const witnessed = yield* Deferred.make<ConnectionId>();
            yield* answering(connections, (admitted) =>
              Effect.andThen(
                Deferred.succeed(witnessed, admitted.connection),
                admitted.reply({ _tag: 'Status', status: status(registration) }),
              ),
            );
            const held = yield* Effect.scoped(
              Effect.gen(function* () {
                const executions = yield* client(registration, 'custodian');
                yield* executions.status();
                const bound = yield* Deferred.await(witnessed);
                const taken = yield* custodian.take(keyOf('take-1'), 0, bound, 'custodian');
                yield* Effect.sleep(`${helloMs} millis`);
                yield* executions.status();
                return taken.standing;
              }),
            );
            let standing = yield* custodian.current();
            while (standing._tag !== 'Settled' || standing.custody.holder !== undefined) {
              yield* Effect.sleep('20 millis');
              standing = yield* custodian.current();
            }
            return { held, standing };
          }),
        { ...limits, helloMs },
      );

      expect(outcome.held.holder).toBeDefined();
      expect(outcome.standing._tag).toBe('Settled');
      if (outcome.standing._tag !== 'Settled') return;
      expect(outcome.standing.custody.holder).toBeUndefined();
      expect(outcome.standing.custody.revision).toBeGreaterThan(outcome.held.revision);
    }),
  );
});

const words = new TextEncoder();
const heard = new TextDecoder();

class ConversationFailed extends Data.TaggedError('ConversationFailed')<{ readonly message: string }> {}

const converse = (path: string, sent: ReadonlyArray<string>, expected: number) =>
  Effect.callback<ReadonlyArray<Uint8Array>, ConversationFailed>((resume) => {
    const reader = frameReader(clientLimits);
    const received: Uint8Array[] = [];
    let connection: Bun.Socket<undefined> | undefined;
    let ended = false;
    const finish = (outcome: Effect.Effect<ReadonlyArray<Uint8Array>, ConversationFailed>) => {
      if (ended) return;
      ended = true;
      connection?.end();
      resume(outcome);
    };
    Bun.connect<undefined>({
      unix: path,
      socket: {
        open: (socket) => {
          connection = socket;
          if (ended) return void socket.end();
          for (const header of sent) socket.write(encodeFrame(words.encode(header), EMPTY_PAYLOAD));
        },
        data: (_socket, chunk) => {
          if (ended) return;
          const read = reader.push(chunk);
          if (read._tag === 'Fault') return finish(Effect.fail(new ConversationFailed({ message: read.fault.detail })));
          for (const frame of read.frames) {
            received.push(frame.header.slice());
            frame.release();
          }
          if (received.length >= expected) finish(Effect.succeed(received));
        },
        error: (_socket, error) => finish(Effect.fail(new ConversationFailed({ message: error.message }))),
        close: () =>
          finish(Effect.fail(new ConversationFailed({ message: `the socket ended after ${received.length} of ${expected} frames` }))),
      },
    }).catch((error) => finish(Effect.fail(new ConversationFailed({ message: String(error) }))));
    return Effect.sync(() => {
      ended = true;
      connection?.terminate();
    });
  });

layer(platform, { excludeTestServices: true })('the execution wire', (it) => {
  it.effect('a client of this release is welcomed in this wire with the capabilities the host serves', () =>
    Effect.gen(function* () {
      const directory = directories.open();
      const met = yield* over(directory, (registration) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const secret = (yield* files.readFileString(registration.credentials.custodian)).trimEnd();
          const preface = JSON.stringify({ magic: WIRE_MAGIC, wire: WIRE_RANGE });
          const hello = JSON.stringify({
            v: WIRE_VERSION,
            body: 'bytes',
            message: {
              _tag: 'Hello',
              request: 0,
              installation: registration.installation,
              protocol: registration.protocol,
              role: 'custodian',
              secret,
              client: { name: 'current', version: '36' },
            },
          });
          const frames = yield* converse(registration.endpoint.path, [preface, hello], 2);
          return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HostFrame))(heard.decode(frames[1]));
        }),
      );
      expect(met.v).toBe(WIRE_VERSION);
      expect(met.body === 'bytes' && met.message._tag === 'Welcome' ? met.message.capabilities : undefined).toEqual([...CAPABILITIES]);
    }),
  );
});
