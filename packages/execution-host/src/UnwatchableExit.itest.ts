import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Deferred, Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { ExecutionStop } from './registry/stops';
import { ExecutionRetirement } from './registry/retention';
import { HostLifecycle } from './registry/shutdown';
import type { HostClaim } from './registry/state';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { connectionOf, hostProfile, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { Holder, HolderRefused } from './holder/Holder';
import { testHolder } from './posix/testing/holder';

const profile = hostProfile({ executions: 2 });
const brokenHolder = (directory: string) =>
  Layer.effect(
    Holder,
    Effect.map(Holder, (real) =>
      Holder.of({
        ...real,
        get held() {
          return real.held;
        },
        launch: (launch) =>
          Effect.map(real.launch(launch), (held) =>
            launch.argv.includes('UNWATCHABLE')
              ? {
                  ...held,
                  exit: Effect.fail(
                    new HolderRefused({ act: 'exit', reason: 'os', detail: `waitid ECHILD on pid ${held.pid}: no child processes` }),
                  ),
                }
              : held,
          ),
      }),
    ),
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
    Layer.provide(brokenHolder(directory)),
    Layer.provideMerge(hostSpawner),
    Layer.provide(BunFileSystem.layer),
    Layer.provide(BunPath.layer),
  );
};
const launch = (cwd: string, program: string, args: readonly string[]): LaunchRequest => ({
  command: { program, args, environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd, dependencies: [] },
  holder: principalOf('tester'),
  origin: principalOf('tester'),
});

it.live('an unreadable exit stays unverified until forgotten, wakes its waiter, and never completes a call off absence', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'unwatchable-exit-' });
    yield* Effect.gen(function* () {
      const executions = yield* Executions;
      const requests = yield* ExecutionRequest;
      const stops = yield* ExecutionStop;
      const retirement = yield* ExecutionRetirement;
      const lifecycle = yield* HostLifecycle;
      const custodian = yield* Custodian;
      const connection = connectionOf('watcher');
      const took = yield* custodian.take(keyOf('take-watcher'), 0, connection, 'custodian');
      const claim: HostClaim = { connection, epoch: took.standing.epoch, role: 'custodian' };
      const started = yield* executions.start(claim, keyOf('op-unwatchable'), launch(directory, '/bin/echo', ['UNWATCHABLE']));
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
      const execution = started.execution.execution;
      const ending = yield* stops.ending(execution).pipe(
        Effect.flatMap((receipt) => (receipt === undefined ? Effect.fail('unmeasured' as const) : Effect.succeed(receipt))),
        Effect.retry({ schedule: Schedule.spaced('25 millis'), while: (failure) => failure === 'unmeasured' }),
      );
      expect('nativeExit' in ending).toBe(false);
      expect(ending.cleanup).toBe('unverifiable');
      expect(ending.unverifiable.length).toBeGreaterThan(0);
      expect(ending.unverifiable[0]?.reason).toContain('ECHILD');
      expect(ending.streams).toContainEqual({ stream: 'stdout', ending: 'eof' });
      expect((yield* requests.callResult(keyOf('op-unwatchable')))._tag).toBe('Pending');

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
      expect((yield* retirement.retire(claim, keyOf('op-retire-waiter'), execution))._tag).toBe('Forgotten');
      yield* Fiber.join(watching);
      expect(yield* executions.summary(execution)).toBeUndefined();
      expect(yield* stops.ending(execution)).toMatchObject({ cleanup: 'unverifiable' });
      expect(yield* requests.callResult(keyOf('op-unwatchable'))).toMatchObject({ _tag: 'Settled', result: { _tag: 'Unavailable' } });

      const running = yield* executions.start(claim, keyOf('op-running'), launch(directory, '/bin/sleep', ['30']));
      if (running._tag !== 'Started') return yield* Effect.die(new Error(`start: ${running._tag}`));
      expect(yield* retirement.retire(claim, keyOf('op-retire-running'), running.execution.execution)).toMatchObject({
        _tag: 'ForgetRefused',
        reason: 'running',
      });
      yield* lifecycle.shutdown(claim, keyOf('op-end-running'));
    }).pipe(Effect.provide(composed(directory)));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
