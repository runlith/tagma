import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Effect, FileSystem, Layer, Schedule, Scope } from 'effect';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { ExecutionStop } from './registry/stops';
import { ExecutionRetirement } from './registry/retention';
import type { HostClaim } from './registry/state';
import { ExecutionStore } from './store/ExecutionStore';
import { StoreLost } from './store/errors';
import { connectionOf, keyOf, principalOf, registrationOf, signalConnection } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { Holder } from './holder/Holder';
import { Processes } from './ProcessReader';
import { ProcessControl } from './ProcessControl';

const launchOf = (directory: string): LaunchRequest => ({
  command: { program: '/bin/sh', args: ['-c', 'exec sleep 30'], environment: [] },
  transport: { _tag: 'pipes', stdin: 'pipe' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: directory, dependencies: [] },
  holder: principalOf('agent'),
  origin: principalOf('agent'),
  budget: {},
});
const native = (directory: string) =>
  Layer.effect(
    Holder,
    Effect.gen(function* () {
      const real = yield* Holder;
      const control = yield* ProcessControl;
      const scope = yield* Effect.scope;
      return Holder.of({
        ...real,
        get held() {
          return real.held;
        },
        launch: Effect.fnUntraced(function* (request) {
          const held = yield* real.launch(request);
          const witness = { pid: held.pid, birth: held.birth };
          yield* Scope.addFinalizer(
            scope,
            Effect.gen(function* () {
              const delivered = yield* control.act(witness, 'kill');
              if (delivered === 'unreadable' || delivered === 'refused') return yield* Effect.die(new Error(`child cleanup: ${delivered}`));
              const ended = yield* control
                .standing(witness)
                .pipe(Effect.repeat({ while: (state) => state === 'standing', schedule: Schedule.spaced('1 millis') }));
              if (ended === 'unreadable') return yield* Effect.die(new Error('child cleanup could not be measured'));
            }),
          );
          return held;
        }),
      });
    }),
  ).pipe(Layer.provideMerge(testHolder(directory)));
type WorldInput = { readonly directory: string; readonly failRecordState?: boolean };
const composed = ({ directory, failRecordState = false }: WorldInput) => {
  const state = hostState(
    `${directory}/executions.sqlite`,
    registrationOf(directory),
    new ProcessPool(undefined, 'stop', undefined, childHosting),
  ).pipe(Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 1, transports: ['pipes'] }))));
  const store = failRecordState
    ? Layer.effect(
        ExecutionStore,
        Effect.gen(function* () {
          const real = yield* ExecutionStore;
          return ExecutionStore.of({
            ...real,
            recordState: () => Effect.fail(new StoreLost({ reason: 'the Started receipt met a dead writer', cleanup: 'owned' })),
          });
        }),
      ).pipe(Layer.provideMerge(state))
    : state;
  return ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(store),
    Layer.provide(Layer.effectContext(Effect.map(Layer.build(native(directory)), Context.omit(Processes)))),
    Layer.provide(hostSpawner),
  );
};
const claim = Effect.gen(function* () {
  const custodian = yield* Custodian;
  const connection = connectionOf('connection-host');
  const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
  return { connection, epoch: taken.standing.epoch, role: 'custodian' } satisfies HostClaim;
});
const awaitLoss = (store: ExecutionStore['Service']) =>
  store
    .operationOf(keyOf('loss-probe'))
    .pipe(
      Effect.andThen(Effect.fail('writer-live' as const)),
      Effect.catchTag('StoreLost', Effect.succeed),
      Effect.retry({ while: (failure) => failure === 'writer-live', schedule: Schedule.spaced('1 millis') }),
    );

it.live(
  'a Started receipt lost to the writer names its phase and cleanup obligation, and retirement cannot erase that unrecorded execution',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-store-loss-start-' });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const executions = yield* Executions;
          const stops = yield* ExecutionStop;
          const retirement = yield* ExecutionRetirement;
          const ownership = yield* claim;
          const operation = keyOf('loss-spawn');
          const started = yield* executions.start(ownership, operation, launchOf(directory));
          expect(started).toMatchObject({
            _tag: 'Uncertain',
            effect: { _tag: 'StoreFailed', operation, phase: 'running', cleanup: 'owned' },
          });
          if (started._tag !== 'Uncertain' || started.effect._tag !== 'StoreFailed' || started.effect.execution === undefined)
            return yield* Effect.die(new Error(`start: ${started._tag}`));
          const ref = started.effect.execution;
          yield* stops.stop(ownership, keyOf('loss-spawn-stop'), ref.execution, 'explicit-stop', 'signal');
          yield* stops
            .ending(ref.execution)
            .pipe(Effect.repeat({ until: (ending) => ending !== undefined, schedule: Schedule.spaced('1 millis') }));
          expect((yield* Effect.flip(retirement.retire(ownership, keyOf('loss-retire'), ref.execution)))._tag).toBe('ExecutionUnrecorded');
          expect((yield* Effect.flip(retirement.retire(ownership, keyOf('loss-retire'), ref.execution)))._tag).toBe('ExecutionUnrecorded');
          expect((yield* executions.summary(ref.execution))?.state.ref).toEqual(ref);
        }),
      ).pipe(Effect.provide(composed({ directory, failRecordState: true })));
    }).pipe(Effect.provide(BunServices.layer)),
);

it.live('a dead writer leaves a known key StoreFailed with measured volatile phase, and an unknown key in flight', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-store-loss-readback-' });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const executions = yield* Executions;
        const requests = yield* ExecutionRequest;
        const store = yield* ExecutionStore;
        const ownership = yield* claim;
        const operation = keyOf('loss-live');
        const started = yield* executions.start(ownership, operation, launchOf(directory));
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const before = yield* executions.summary(started.execution.execution);
        if (before === undefined) return yield* Effect.die(new Error('the live phase was not readable'));
        yield* Effect.promise(() => signalConnection('SIGKILL'));
        const loss = yield* awaitLoss(store);
        const back = yield* requests.operation(operation);
        expect(back).toMatchObject({
          _tag: 'Uncertain',
          effect: { _tag: 'StoreFailed', operation, execution: started.execution, phase: before.state.phase, cleanup: 'owned' },
        });
        expect(loss.cleanup).toBe('owned');
        if (back._tag !== 'Uncertain' || back.effect._tag !== 'StoreFailed')
          return yield* Effect.die(new Error('readback carried no store failure'));
        expect(back.effect.reason.length).toBeGreaterThan(0);
        expect(yield* requests.operation(keyOf('loss-unknown'))).toEqual({
          _tag: 'Uncertain',
          effect: { _tag: 'InFlight', operation: keyOf('loss-unknown') },
        });
      }),
    ).pipe(Effect.provide(composed({ directory })));
  }).pipe(Effect.provide(BunServices.layer)),
);
