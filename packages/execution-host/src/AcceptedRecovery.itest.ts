import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Deferred, Effect, FileSystem, Layer } from 'effect';
import type { CommandAdmission } from '@runlith/executions/protocol/command';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { ExecutionStop } from './registry/stops';
import type { HostClaim } from './registry/state';
import { connectionOf, hostTestRoot, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const agent = principalOf('agent-1');
const startKey = keyOf('accept-b');
const stopKey = keyOf('stop-b');

const admissionOf = (): CommandAdmission => ({
  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
  limits: { executionMs: 60_000, executionCeilingMs: 300_000 },
  policyIdentity: 'policy-1',
});

const commandOf = (program: string, args: ReadonlyArray<string>): LaunchRequest => ({
  command: { program, args: [...args], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  admission: admissionOf(),
});

const registry = (directory: string) =>
  ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(
      Layer.unwrap(Effect.map(sharedPool, (pool) => hostState(join(directory, 'executions.sqlite'), registrationOf(directory), pool))).pipe(
        Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 2, transports: ['pipes'] }))),
      ),
    ),
    Layer.provide(testHolder(directory)),
  );

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner), { excludeTestServices: true })(
  'a replaced accepted execution',
  (it) => {
    it.effect(
      'spends its START and STOP keys with its generation and reclaims the ending that generation measured',
      Effect.fnUntraced(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = hostTestRoot();
        yield* fs.makeDirectory(root, { recursive: true });
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'accepted-recovery-' });
        const records = join(directory, 'records');
        const held = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        let parking = false;
        const files = Layer.effect(
          FileSystem.FileSystem,
          Effect.gen(function* () {
            const real = yield* FileSystem.FileSystem;
            return FileSystem.FileSystem.of({
              ...real,
              makeDirectory: (path, options) =>
                Effect.andThen(
                  parking && path.startsWith(records)
                    ? Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(held))
                    : Effect.void,
                  real.makeDirectory(path, options),
                ),
            });
          }),
        ).pipe(Layer.provide(BunFileSystem.layer));
        const owned = yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(registry(directory).pipe(Layer.provideMerge(files)));
            return yield* Effect.gen(function* () {
              const custodian = yield* Custodian;
              const executions = yield* Executions;
              const stops = yield* ExecutionStop;
              const connection = connectionOf('connection-host');
              const taken = yield* custodian.take(keyOf('take-host-0'), 0, connection, 'custodian');
              const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
              return yield* Effect.acquireUseRelease(
                Effect.sync(() => {
                  parking = true;
                }),
                () =>
                  Effect.gen(function* () {
                    const queued = yield* executions.start(claim, startKey, commandOf('/bin/sh', ['-c', 'exit 0']));
                    if (queued._tag !== 'Accepted') return yield* Effect.die(new Error(`setup accepted no queued work: ${queued._tag}`));
                    yield* Deferred.await(entered);
                    yield* stops.stop(claim, stopKey, queued.execution.execution, 'explicit-stop', 'signal');
                    return queued.execution.execution;
                  }),
                () =>
                  Effect.andThen(
                    Effect.sync(() => {
                      parking = false;
                    }),
                    Deferred.succeed(held, undefined),
                  ),
              );
            }).pipe(Effect.provide(context));
          }),
        );
        const context = yield* Layer.build(registry(directory));
        yield* Effect.gen(function* () {
          const custodian = yield* Custodian;
          const executions = yield* Executions;
          const requests = yield* ExecutionRequest;
          const stops = yield* ExecutionStop;
          const connection = connectionOf('connection-host');
          const taken = yield* custodian.take(keyOf('take-host-1'), 1, connection, 'custodian');
          const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
          expect(yield* requests.operation(startKey)).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'IncarnationMismatch' } });
          expect(yield* executions.start(claim, startKey, commandOf('/bin/sh', ['-c', 'exit 0']))).toMatchObject({
            _tag: 'Refused',
            refusal: { _tag: 'OperationConflict' },
          });
          expect(yield* requests.operation(stopKey)).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'IncarnationMismatch' } });
          expect(yield* stops.ending(owned)).toBeUndefined();
        }).pipe(Effect.provide(context));
      }),
    );
  },
);
