import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Cause, Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { CAPABILITIES } from '@runlith/executions/protocol/capability';
import { Principal } from '@runlith/executions/protocol/custody';
import { answer } from './answers';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { HostAdmission } from './HostAdmission';
import { HostConnections, type Admitted } from './HostConnections';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { keyOf, registrationOf } from './hostFixture';
import { runtimeProfile } from './runtimeFixture';
import { credentialsLayer } from './posix/credentials';
import { endpointLayer } from './posix/endpoint';
import { testHolder } from './posix/testing/holder';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { HostCommands, HostProcessFacts } from './registry/inventory';
import { CustodyControl, InputLanes, PaceControl } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords, TerminalScreen } from './registry/reads';
import { ExecutionRetirement, HostDisown } from './registry/retention';
import { HostLifecycle } from './registry/shutdown';
import { ExecutionStore } from './store/ExecutionStore';
import { StoreLost } from './store/errors';

const platform = Layer.merge(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

it.live('wire cancellation cannot turn a delivered stop into proven absence, and prevention cannot erase admitted work', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'stop-admission-' });
    yield* files.makeDirectory(join(directory, 'records'));
    const registrations = yield* HostRegistration;
    const offered = registrationOf(directory);
    const { registration } = yield* registrations.publish(directory, {
      installation: offered.installation,
      protocol: offered.protocol,
      endpoint: offered.endpoint,
      credentials: offered.credentials,
    });
    const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });
    const holder = testHolder(directory);
    const capacity = ExecutionCapacity.layer(profile);
    const state = yield* Layer.build(
      hostState(join(directory, 'executions.sqlite'), registration, yield* sharedPool).pipe(
        Layer.provideMerge(capacity),
        Layer.provideMerge(holder),
      ),
    );
    const store = Context.get(state, ExecutionStore);
    const beforeAdmission = keyOf('delivered-before-admission');
    const afterAdmission = keyOf('already-admitted');
    const lostAdmission = keyOf('admission-unavailable');
    const delivered = yield* Deferred.make<void>();
    const releaseDelivered = yield* Deferred.make<void>();
    const deliveredDone = yield* Deferred.make<void>();
    const recorded = yield* Deferred.make<void>();
    const releaseRecorded = yield* Deferred.make<void>();
    let parked = false;
    const delayedStore = ExecutionStore.of({
      ...store,
      recordStop: Effect.fnUntraced(function* (intent) {
        if (intent.operation.operation === lostAdmission.operation) {
          return yield* new StoreLost({ reason: 'the admission write is unavailable', cleanup: 'unknown' });
        }
        yield* store.recordStop(intent);
        if (intent.operation.operation !== afterAdmission.operation || parked) return;
        parked = true;
        yield* Deferred.succeed(recorded, undefined);
        yield* Deferred.await(releaseRecorded);
      }),
    });
    const owners = yield* Layer.build(
      ExecutionRegistry.layer().pipe(
        Layer.provideMerge(Bindings.layer),
        Layer.provideMerge(Layer.succeedContext(Context.add(state, ExecutionStore, delayedStore))),
        Layer.provide(hostSpawner),
      ),
    );
    const incarnation = (yield* store.incarnation()).incarnation;
    const served = new Set(CAPABILITIES);
    const limits = { frameBytes: 1_048_576, headerBytes: 1_048_576, connections: 2, requests: 4, subscriptions: 2, credits: 4096 };
    const connected = yield* Layer.build(
      HostConnections.layer(registration, incarnation, limits, served).pipe(
        Layer.provide(Layer.succeedContext(owners)),
        Layer.provide(credentialsLayer(registration.credentials)),
        Layer.provide(endpointLayer),
      ),
    );
    const connections = Context.get(connected, HostConnections);
    const dispatch = (admitted: Admitted) =>
      answer(
        Context.get(owners, Executions),
        Context.get(owners, ExecutionRequest),
        Context.get(owners, HostCommands),
        Context.get(owners, HostProcessFacts),
        Context.get(owners, InputLanes),
        Context.get(owners, CustodyControl),
        Context.get(owners, ExecutionStop),
        Context.get(owners, HostByteRecords),
        Context.get(owners, TerminalScreen),
        Context.get(owners, ExecutionRetirement),
        Context.get(owners, HostLifecycle),
        Context.get(owners, PaceControl),
        Context.get(owners, HostDisown),
        Context.get(owners, Bindings),
        Context.get(owners, Custodian),
        Context.get(owners, ExecutionCapacity),
        Context.get(owners, HostAdmission),
        undefined,
        undefined,
        admitted,
        4096,
        incarnation,
        registration.installation,
      );
    yield* connections.open;
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(connections.admitted, (admitted) =>
          Effect.forkScoped(
            admitted.body._tag === 'Stop' && admitted.body.operation.operation === beforeAdmission.operation
              ? Deferred.succeed(delivered, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseDelivered)),
                  Effect.andThen(dispatch(admitted)),
                  Effect.ensuring(Deferred.succeed(deliveredDone, undefined)),
                )
              : Effect.suspend(() => dispatch(admitted)).pipe(Effect.tapCause((cause) => Effect.logError(Cause.pretty(cause)))),
          ),
        ),
      ),
    );
    const client = yield* ExecutionClient.make({
      address: { state: directory, installation: registration.installation },
      role: 'custodian',
      limits,
    });
    const status = yield* client.status();
    const taken = yield* client.take(keyOf('take'), status.custody.revision);
    expect(taken._tag).toBe('Held');
    if (taken._tag !== 'Held' || taken.custody.holder === undefined) return;
    const claim = { connection: taken.custody.holder.connection, epoch: taken.custody.epoch, role: 'custodian' as const };
    yield* Effect.addFinalizer(() =>
      Deferred.succeed(releaseDelivered, undefined).pipe(
        Effect.andThen(Deferred.succeed(releaseRecorded, undefined)),
        Effect.andThen(Context.get(owners, HostLifecycle).shutdown(claim, keyOf('cleanup'))),
        Effect.asVoid,
        Effect.orDie,
      ),
    );
    const launched = yield* client.start(keyOf('runner'), {
      command: { program: '/bin/cat', args: [], environment: [] },
      transport: { _tag: 'pipes', stdin: 'pipe' },
      lifetime: 'held',
      purpose: 'command',
      target: { environment: 'test', namespace: 'test', cwd: directory, dependencies: [] },
      holder: Principal.make('operator'),
      origin: Principal.make('operator'),
    });
    expect(launched._tag).toBe('Started');
    if (launched._tag !== 'Started') return;
    const execution = launched.execution;
    const first = yield* Effect.forkChild(client.stop(beforeAdmission, execution, 'explicit-stop', 'signal'));
    yield* Deferred.await(delivered);
    yield* Fiber.interrupt(first);
    expect((yield* client.operation(beforeAdmission))._tag).toBe('Unanswered');
    expect((yield* client.preventStop(beforeAdmission, execution))._tag).toBe('Prevented');
    yield* Deferred.succeed(releaseDelivered, undefined);
    yield* Deferred.await(deliveredDone);
    expect((yield* client.state(execution))?.state.phase).toBe('running');
    expect(yield* Effect.flip(client.stop(beforeAdmission, execution, 'explicit-stop', 'signal'))).toMatchObject({
      _tag: 'HostRefused',
      refusal: { _tag: 'OperationConflict' },
    });
    expect(yield* Effect.flip(client.stop(lostAdmission, execution, 'explicit-stop', 'signal'))).toMatchObject({
      _tag: 'HostRefused',
      refusal: { _tag: 'HostUnavailable' },
    });
    expect((yield* client.state(execution))?.state.phase).toBe('running');
    const second = yield* Effect.forkChild(client.stop(afterAdmission, execution, 'explicit-stop', 'signal'));
    yield* Deferred.await(recorded);
    expect((yield* client.preventStop(afterAdmission, execution))._tag).toBe('Taken');
    expect((yield* client.operation(afterAdmission))._tag).toBe('Uncertain');
    yield* Deferred.succeed(releaseRecorded, undefined);
    expect((yield* Fiber.join(second)).execution).toEqual(execution);
    expect((yield* client.state(execution))?.state.phase).toBe('ended');
    served.delete('prevent-stop');
    expect(yield* Effect.flip(client.preventStop(keyOf('unsupported'), execution))).toMatchObject({
      _tag: 'HostRefused',
      refusal: { _tag: 'UnsupportedCapability' },
    });
  }).pipe(Effect.provide(platform)),
);
