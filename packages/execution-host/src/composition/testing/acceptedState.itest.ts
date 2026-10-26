import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { kind, world } from '@runlith/testbed/worlds';
import { Context, Deferred, Effect, Fiber, Layer, Schedule, Schema, Stream } from 'effect';
import * as Socket from 'effect/socket/Socket';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { frameReader } from '@runlith/executions/protocol/frames';
import { HostFrame, HostMessageText } from '@runlith/executions/protocol/wire';
import { byteOffset } from '@runlith/executions/protocol/record';
import { Holder } from '../../holder/Holder';
import { testHolder } from '../../posix/testing/holder';
import { hostPolicy, hostShare, hostWireLimits } from '../../hostFixture';
import { makeWorld, type ServedWorld } from './servedWorld';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 2, requests: 8 });
const frameText = Schema.fromJsonString(HostFrame);
const decoder = new TextDecoder();
const observing = (subscribed: Deferred.Deferred<void>) =>
  Layer.effect(
    EndpointConnection,
    Effect.gen(function* () {
      const real = yield* EndpointConnection;
      return EndpointConnection.of({
        connect: (registration) =>
          Effect.map(real.connect(registration), (socket) => {
            const reader = frameReader(limits);
            let preface = true;
            return Socket.make({
              writer: socket.writer,
              reader: Effect.map(socket.reader, (source) => ({
                ...source,
                pull: source.pull.pipe(
                  Effect.tap((chunks) =>
                    Effect.gen(function* () {
                      for (const chunk of chunks) {
                        const read = reader.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
                        if (read._tag === 'Fault') return yield* Effect.die(new Error(read.fault.detail));
                        for (const frame of read.frames) {
                          yield* Effect.gen(function* () {
                            if (preface) {
                              preface = false;
                              return;
                            }
                            const envelope = yield* Schema.decodeUnknownEffect(frameText)(decoder.decode(frame.header));
                            const message =
                              envelope.body === 'bytes'
                                ? envelope.message
                                : yield* Schema.decodeUnknownEffect(HostMessageText)(decoder.decode(frame.payload));
                            if (message._tag === 'Reply' && message.body._tag === 'Subscribed')
                              yield* Deferred.succeed(subscribed, undefined);
                          }).pipe(Effect.ensuring(Effect.sync(() => frame.release())));
                        }
                      }
                    }).pipe(Effect.orDie),
                  ),
                ),
              })),
            });
          }),
      });
    }),
  ).pipe(Layer.provide(endpointConnection));

type PendingWorld = ServedWorld & {
  readonly entered: Deferred.Deferred<void>;
  readonly held: Deferred.Deferred<void>;
  readonly subscribed: Deferred.Deferred<void>;
};
class World extends Context.Service<World, PendingWorld>()('testing/AcceptedCommand') {}
const acceptedWorld = kind(World, (_params: null, home) =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    const subscribed = yield* Deferred.make<void>();
    const platform = Layer.merge(HostRegistration.layer, observing(subscribed)).pipe(Layer.provideMerge(BunServices.layer));
    const served = yield* makeWorld({
      prefix: 'accepted-state-',
      directory: `${home}/state`,
      policy,
      limits,
      share: hostShare(policy, 2),
      holder: (directory) =>
        Layer.effect(
          Holder,
          Effect.map(Holder, (real) =>
            Holder.of({
              ...real,
              launch: (request) =>
                Effect.andThen(Deferred.succeed(entered, undefined), Effect.andThen(Deferred.await(held), real.launch(request))),
            }),
          ),
        ).pipe(Layer.provideMerge(testHolder(directory))),
    }).pipe(Effect.provide(platform));
    return { ...served, entered, held, subscribed };
  }),
);

const untilEnded = (deliveries: Stream.Stream<ExecutionFeedItem, unknown>) =>
  Stream.runCollect(Stream.takeUntil(deliveries, (delivery) => delivery._tag === 'Ended'));
const decided = (delivery: ExecutionFeedItem): boolean =>
  delivery._tag === 'State' && (delivery.summary.decision !== undefined || delivery.summary.state.unacquired !== undefined);

layer(world(acceptedWorld, null), { excludeTestServices: true })('an accepted command over the wire', (it) => {
  it.effect('a state subscription opened during setup delivers its decided state before it ends', () =>
    Effect.gen(function* () {
      const { client, directory, registration, entered, held, subscribed } = yield* World;
      yield* Effect.addFinalizer(() => Deferred.succeed(held, undefined));
      const key = (name: string) => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const principal = Principal.make('tester');
      const launch: LaunchRequest = {
        command: { program: '/bin/echo', args: [], environment: [] },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'command',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
        admission: {
          origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
          limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
          policyIdentity: 'policy-1',
        },
      };
      const started = yield* client.start(key('command'), launch);
      if (started._tag !== 'Accepted') return yield* Effect.die(new Error(`not accepted: ${started._tag}`));
      yield* Deferred.await(entered);
      const states = yield* Effect.forkScoped(
        untilEnded(client.subscribe({ _tag: 'State', execution: started.execution }, limits.credits)),
      );
      yield* Deferred.await(subscribed);
      const queued = yield* client.commandsAt([started.execution]);
      expect(queued.commands[0]?.state.phase).toBe('queued');
      yield* Deferred.succeed(held, undefined);
      const cursor = { ref: started.execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const [delivered] = yield* Effect.all(
        [
          Fiber.join(states),
          untilEnded(client.subscribe({ _tag: 'Bytes', cursor }, 65536)),
          untilEnded(client.subscribe({ _tag: 'Bytes', cursor: { ...cursor, stream: 'stderr' } }, 65536)),
        ],
        { concurrency: 3 },
      );
      expect(delivered.some(decided), JSON.stringify(delivered)).toBe(true);
      expect(delivered.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });

      const missing = yield* client.start(key('missing'), {
        ...launch,
        command: { ...launch.command, program: `${directory}/missing` },
      });
      if (missing._tag !== 'Accepted') return yield* Effect.die(new Error(`not accepted: ${missing._tag}`));
      yield* client.commandsAt([missing.execution]).pipe(
        Effect.repeat({
          until: (batch) => batch.commands[0]?.state.phase === 'ended',
          schedule: Schedule.spaced('10 millis'),
        }),
      );
      const refused = yield* untilEnded(client.subscribe({ _tag: 'State', execution: missing.execution }, limits.credits));
      expect(refused[0]).toMatchObject({
        _tag: 'State',
        summary: { state: { phase: 'ended', cleanup: 'complete', record: 'unavailable', unacquired: expect.any(String) } },
      });
      expect(refused.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
    }),
  );
});
