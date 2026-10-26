import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Deferred, Effect, Fiber, FileSystem, Layer, Schedule, Scope } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { ExecutionStop } from './registry/stops';
import { ExecutionRetirement } from './registry/retention';
import type { HostClaim } from './registry/state';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { connectionOf, hostProfile, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { Holder, type Readable } from './holder/Holder';
import { testHolder } from './posix/testing/holder';
import { ProcessControl } from './ProcessControl';

const profile = hostProfile({ executions: 2 });
const dying = (stdout: Readable): Readable => {
  let delivered = false;
  return {
    read: (limit) =>
      Effect.suspend(() =>
        delivered
          ? Effect.die(new Error('read loop defect'))
          : Effect.tap(stdout.read(limit), (chunk) =>
              Effect.sync(() => {
                delivered = chunk !== undefined && chunk.length > 0;
              }),
            ),
      ),
    stopReading: stdout.stopReading,
  };
};
const brokenHolder = (directory: string) =>
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
        launch: Effect.fnUntraced(function* (launch) {
          const held = yield* real.launch(launch);
          if (!launch.argv.some((argument) => argument.includes('PIPEDEATH')) || held.channels._tag !== 'pipes') return held;
          const witness = { pid: held.pid, birth: held.birth };
          yield* Scope.addFinalizer(
            scope,
            Effect.gen(function* () {
              const delivered = yield* control.act(witness, 'kill');
              if (delivered === 'unreadable' || delivered === 'refused') return yield* Effect.die(new Error(`child cleanup: ${delivered}`));
              const ended = yield* control
                .standing(witness)
                .pipe(Effect.repeat({ while: (state) => state === 'standing', schedule: Schedule.spaced('1 millis') }));
              if (ended === 'unreadable') return yield* Effect.die(new Error('the child cleanup could not be measured'));
            }),
          );
          return { ...held, channels: { ...held.channels, stdout: dying(held.channels.stdout) } };
        }),
      });
    }),
  ).pipe(Layer.provideMerge(testHolder(directory)));
const composed = (directory: string) => {
  const base = Layer.unwrap(
    Effect.map(sharedPool, (pool) => hostState(`${directory}/executions.sqlite`, registrationOf(directory), pool)),
  ).pipe(
    Layer.provideMerge(ExecutionCapacity.layer(profile)),
    Layer.provide(hostSpawner),
    Layer.provide(BunFileSystem.layer),
    Layer.provide(BunPath.layer),
  );
  return ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(base),
    Layer.provideMerge(brokenHolder(directory)),
    Layer.provideMerge(hostSpawner),
    Layer.provide(BunFileSystem.layer),
    Layer.provide(BunPath.layer),
  );
};
const launch = (cwd: string, line: string): LaunchRequest => ({
  command: { program: '/bin/sh', args: ['-c', line], environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd, dependencies: [] },
  holder: principalOf('tester'),
  origin: principalOf('tester'),
});

it.live('a dead byte pipeline names its loss, wakes a forgetting reader, and leaves a healthy execution complete', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'pipeline-death-' });
    yield* Effect.gen(function* () {
      const executions = yield* Executions;
      const requests = yield* ExecutionRequest;
      const stops = yield* ExecutionStop;
      const retirement = yield* ExecutionRetirement;
      const custodian = yield* Custodian;
      const connection = connectionOf('death');
      const took = yield* custodian.take(keyOf('take-death'), 0, connection, 'custodian');
      const claim: HostClaim = { connection, epoch: took.standing.epoch, role: 'custodian' };
      const started = yield* executions.start(claim, keyOf('op-death'), launch(directory, 'echo PIPEDEATH; exec sleep 30'));
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
      const execution = started.execution.execution;
      const ending = yield* stops.ending(execution).pipe(
        Effect.flatMap((receipt) => (receipt === undefined ? Effect.fail('unmeasured' as const) : Effect.succeed(receipt))),
        Effect.retry({ schedule: Schedule.spaced('25 millis'), while: (failure) => failure === 'unmeasured' }),
      );
      expect('nativeExit' in ending).toBe(false);
      expect(ending).toMatchObject({ cleanup: 'unverifiable', relation: 'unknown', confirmed: [] });
      expect(ending.unverifiable.map((row) => row.kind)).toContain('record');
      expect(ending.unverifiable.some((row) => row.reason.includes('read loop defect'))).toBe(true);
      expect(ending.streams).toContainEqual({ stream: 'stdout', ending: 'error' });
      expect((yield* requests.callResult(keyOf('op-death')))._tag).toBe('Pending');

      const armed = yield* Deferred.make<void>();
      const watching = yield* Effect.forkChild(
        Effect.gen(function* () {
          for (;;) {
            const changed = yield* executions.changed(execution).pipe(Effect.catchTag('ExecutionUnknown', () => Effect.succeed(undefined)));
            yield* Deferred.succeed(armed, undefined);
            if (changed === undefined || (yield* executions.summary(execution)) === undefined) return;
            yield* changed;
          }
        }),
      );
      yield* Deferred.await(armed);
      expect((yield* retirement.retire(claim, keyOf('op-retire-death'), execution))._tag).toBe('Forgotten');
      yield* Fiber.join(watching);
      expect(yield* executions.summary(execution)).toBeUndefined();

      const healthy = yield* executions.start(claim, keyOf('op-healthy'), launch(directory, 'echo done'));
      if (healthy._tag !== 'Started') return yield* Effect.die(new Error(`start: ${healthy._tag}`));
      const healthyEnding = yield* stops.ending(healthy.execution.execution).pipe(
        Effect.flatMap((receipt) => (receipt === undefined ? Effect.fail('unmeasured' as const) : Effect.succeed(receipt))),
        Effect.retry({ schedule: Schedule.spaced('25 millis'), while: (failure) => failure === 'unmeasured' }),
      );
      expect(healthyEnding.cleanup).toBe('complete');
      expect(healthyEnding.streams).toContainEqual({ stream: 'stdout', ending: 'eof' });
      expect((yield* retirement.retire(claim, keyOf('op-retire-healthy'), healthy.execution.execution))._tag).toBe('Forgotten');
    }).pipe(Effect.provide(composed(directory)));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
