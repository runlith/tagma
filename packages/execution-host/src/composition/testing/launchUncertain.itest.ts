import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, FileSystem, Layer } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Holder, HolderLaunchUncertain, type HeldExecution } from '../../holder/Holder';
import { testHolder } from '../../posix/testing/holder';
import { ExecutionStop } from '../../registry/stops';
import { HostLifecycle } from '../../registry/shutdown';
import { ExecutionRegistry } from '../../registry/ExecutionRegistry';
import { Executions } from '../../registry/launch';
import { ExecutionRequest } from '../../registry/operations';
import { ExecutionStore } from '../../store/ExecutionStore';
import { Custodian } from '../../Custodian';
import { Bindings } from '../../Bindings';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { hostState } from '../../hostState';
import { hostSpawner } from '../../hostSpawner';
import { runtimeProfile } from '../../runtimeFixture';
import { connectionOf, fixtureFacts, fixtureHolder, keyOf, principalOf, registrationOf } from '../../hostFixture';
import { PlatformFacts } from '../../PlatformFacts';
import { ProcessControl } from '../../ProcessControl';
import { ProcessTempo } from '../../ProcessTempo';

const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });
const uncertainHolder = Layer.effect(
  Holder,
  Effect.map(Holder, (real) =>
    Holder.of({
      ...real,
      launch: (launch) => Effect.fail(new HolderLaunchUncertain({ execution: launch.id, detail: 'the sent launch has no answer' })),
    }),
  ),
).pipe(Layer.provide(fixtureHolder(0)));
type RegistryInput<E> = { readonly directory: string; readonly holder: Layer.Layer<Holder, E>; readonly profile?: CapabilityProfile };
const registryOver = <E>({ directory, holder, profile: selected = profile }: RegistryInput<E>) => {
  const state = Layer.unwrap(
    Effect.map(sharedPool, (pool) => hostState(`${directory}/executions.sqlite`, registrationOf(directory), pool)),
  ).pipe(Layer.provideMerge(ExecutionCapacity.layer(selected)));
  return ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(state),
    Layer.provideMerge(holder),
    Layer.provideMerge(hostSpawner),
    Layer.provideMerge(Layer.succeed(PlatformFacts, fixtureFacts(selected))),
    Layer.provideMerge(
      Layer.succeed(
        ProcessControl,
        ProcessControl.of({
          standing: () => Effect.succeed('unreadable'),
          act: () => Effect.succeed('unreadable'),
          signal: () => Effect.succeed('unreadable'),
        }),
      ),
    ),
    Layer.provideMerge(Layer.succeed(ProcessTempo, ProcessTempo.of({ directions: () => [], apply: () => Effect.succeed([]) }))),
    Layer.provide(BunServices.layer),
  );
};
const launchOf = (directory: string, stdin: 'pipe' | 'ignore'): LaunchRequest => ({
  command: { program: '/bin/cat', args: [], environment: [], cwd: directory },
  transport: { _tag: 'pipes', stdin },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'test', namespace: 'test', cwd: directory, dependencies: [] },
  holder: principalOf('uncertainty-contract'),
  origin: principalOf('uncertainty-contract'),
});

it.live('a sent launch stays uncertain through readback and reopening its generation', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'launch-uncertain-' });
    const operation = keyOf('uncertain-reservation');
    const launch = launchOf(directory, 'ignore');
    const started = yield* Effect.scoped(
      Effect.gen(function* () {
        const executions = yield* Executions;
        const custodian = yield* Custodian;
        const connection = connectionOf('uncertain-start');
        const taken = yield* custodian.take(keyOf('take-uncertain'), 0, connection, 'custodian');
        const answer = yield* executions.start({ connection, epoch: taken.standing.epoch, role: 'custodian' }, operation, launch);
        expect(answer._tag).toBe('Uncertain');
        if (answer._tag !== 'Uncertain' || !('execution' in answer.effect) || answer.effect.execution === undefined)
          return yield* Effect.die(new Error(JSON.stringify(answer)));
        expect(yield* (yield* ExecutionRequest).operation(operation)).toEqual(answer);
        expect((yield* (yield* ExecutionStore).executionOf(answer.effect.execution.execution)).state.phase).toBe('reserved');
        expect((yield* (yield* ExecutionCapacity).ledger()).executions).toBe(1);
        return answer;
      }).pipe(Effect.provide(registryOver({ directory, holder: uncertainHolder }))),
    );
    if (!('execution' in started.effect) || started.effect.execution === undefined)
      return yield* Effect.die(new Error('the uncertain launch has no execution'));
    const execution = started.effect.execution.execution;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* ExecutionStore;
        expect((yield* store.operationAnswerOf(operation))?.receipt).toEqual(started);
        expect((yield* store.executionOf(execution)).state.phase).toBe('reserved');
      }).pipe(
        Effect.provide(
          hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
            Layer.provideMerge(ExecutionCapacity.layer(profile)),
            Layer.provide(fixtureHolder(0)),
            Layer.provide(BunServices.layer),
          ),
        ),
      ),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* (yield* ExecutionRequest).operation(operation);
        expect(resolved).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'SpawnFailed' } });
        if (resolved._tag !== 'Refused') return yield* Effect.die(new Error(`readback: ${resolved._tag}`));
        expect((yield* (yield* ExecutionStore).executionOf(execution)).state.phase).toBe('ended');
        const custodian = yield* Custodian;
        const current = yield* custodian.current();
        if (current._tag !== 'Settled') return yield* Effect.die(new Error('the fixture custody was not resolved'));
        const connection = connectionOf('uncertain-reopened');
        const taken = yield* custodian.take(keyOf('take-reopened'), current.custody.revision, connection, 'custodian');
        expect(yield* (yield* Executions).start({ connection, epoch: taken.standing.epoch, role: 'custodian' }, operation, launch)).toEqual(
          resolved,
        );
      }).pipe(Effect.provide(registryOver({ directory, holder: fixtureHolder(0) }))),
    );
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('boot adopts the child a lost launch left in the holder table and resolves its receipt as accepted', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'launch-uncertain-present-' });
    const operation = keyOf('uncertain-present');
    const launch = launchOf(directory, 'pipe');
    const context = yield* Layer.build(testHolder(directory).pipe(Layer.provide(hostSpawner), Layer.provide(BunServices.layer)));
    const real = Context.get(context, Holder);
    let retained: HeldExecution | undefined;
    const losing = Holder.of({
      ...real,
      get held() {
        return real.held;
      },
      launch: (spec) =>
        Effect.flatMap(real.launch(spec), (child) => {
          retained = child;
          return Effect.fail(new HolderLaunchUncertain({ execution: spec.id, detail: 'the acquired child reply was lost' }));
        }),
    });
    const answer = yield* Effect.scoped(
      Effect.gen(function* () {
        const custodian = yield* Custodian;
        const connection = connectionOf('present-start');
        const taken = yield* custodian.take(keyOf('take-present'), 0, connection, 'custodian');
        return yield* (yield* Executions).start({ connection, epoch: taken.standing.epoch, role: 'custodian' }, operation, launch);
      }).pipe(Effect.provide(registryOver({ directory, holder: Layer.succeed(Holder, losing) }))),
    );
    expect(answer._tag).toBe('Uncertain');
    const child = retained;
    if (child === undefined) return yield* Effect.die(new Error('the holder acquired no child'));
    if (answer._tag !== 'Uncertain' || !('execution' in answer.effect) || answer.effect.execution === undefined)
      return yield* Effect.die(new Error(JSON.stringify(answer)));
    const execution = answer.effect.execution.execution;
    expect(yield* child.workState).toBe('standing');
    yield* Effect.scoped(
      Effect.gen(function* () {
        expect(yield* (yield* ExecutionRequest).operation(operation)).toEqual(answer);
        expect((yield* (yield* ExecutionStore).executionOf(execution)).state.phase).toBe('reserved');
        expect(yield* child.workState).toBe('standing');
      }).pipe(
        Effect.provide(
          registryOver({
            directory,
            holder: Layer.succeed(Holder, { ...real, held: [child] }),
            profile: runtimeProfile({ executions: 1, transports: ['pty'] }),
          }),
        ),
      ),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const store = yield* ExecutionStore;
        const accepted = yield* (yield* ExecutionRequest).operation(operation);
        expect(accepted._tag).toBe('Accepted');
        if (accepted._tag !== 'Accepted' || accepted.execution === undefined) return yield* Effect.die(new Error(JSON.stringify(accepted)));
        const record = yield* store.executionOf(accepted.execution.execution);
        expect(record.state.phase).toBe('running');
        expect(record.native.pid).toBe(child.pid);
        expect(yield* child.workState).toBe('standing');
        const custodian = yield* Custodian;
        const current = yield* custodian.current();
        if (current._tag !== 'Settled') return yield* Effect.die(new Error('the fixture custody was not resolved'));
        const connection = connectionOf('present-restored');
        const taken = yield* custodian.take(keyOf('take-present-restored'), current.custody.revision, connection, 'custodian');
        const claim = { connection, epoch: taken.standing.epoch, role: 'custodian' as const };
        yield* (yield* ExecutionStop).stop(claim, keyOf('end-present'), accepted.execution.execution, 'explicit-stop', 'destroy');
        yield* (yield* HostLifecycle).shutdown(claim, keyOf('shutdown-present'));
      }).pipe(Effect.provide(registryOver({ directory, holder: Layer.succeed(Holder, { ...real, held: [child] }) }))),
    );
  }).pipe(Effect.provide(BunServices.layer)),
);
