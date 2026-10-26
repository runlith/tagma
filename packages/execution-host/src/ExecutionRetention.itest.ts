import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer } from 'effect';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { ExecutionRetirement } from './registry/retention';
import type { HostClaim } from './registry/state';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });
const composed = (directory: string) => {
  const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner);
  const state = Layer.unwrap(
    Effect.map(sharedPool, (pool) => hostState(`${directory}/executions.sqlite`, registrationOf(directory), pool)),
  ).pipe(Layer.provideMerge(ExecutionCapacity.layer(profile)));
  return ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(state),
    Layer.provide(testHolder(directory)),
    Layer.provideMerge(platform),
  );
};

it.live('names evicted output as partial before retirement and as lost after the record is removed', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-retention-' });
    yield* Effect.gen(function* () {
      const custodian = yield* Custodian;
      const executions = yield* Executions;
      const requests = yield* ExecutionRequest;
      const retirement = yield* ExecutionRetirement;
      const connection = connectionOf('connection-host');
      const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
      const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
      const outputBytes = profile.execution.output.retainedBytes + 2 * profile.execution.output.segmentBytes;
      const launch: LaunchRequest = {
        command: {
          program: '/bin/sh',
          args: ['-c', `yes | head -c ${outputBytes}`],
          environment: [{ name: 'PATH', value: '/usr/bin:/bin' }],
        },
        transport: { _tag: 'pipes', stdin: 'pipe' },
        lifetime: 'call',
        purpose: 'command',
        target: { environment: 'environment-1', namespace: 'namespace-1', cwd: directory, dependencies: [] },
        holder: principalOf('agent'),
        origin: principalOf('agent'),
        budget: {},
      };
      const started = yield* executions.start(claim, keyOf('retention-1'), launch);
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
      const execution = started.execution.execution;
      for (;;) {
        const changed = yield* executions.changed(execution);
        if ((yield* executions.summary(execution))?.state.cleanup === 'complete') break;
        yield* changed;
      }
      expect(yield* requests.callResult(keyOf('retention-1'))).toMatchObject({
        _tag: 'Settled',
        result: { _tag: 'Decided', decision: { _tag: 'Completed' }, nativeExit: { _tag: 'Code', code: 0 }, retention: 'partial' },
      });
      expect((yield* retirement.retire(claim, keyOf('retention-retire'), execution))._tag).toBe('Forgotten');
      expect(yield* requests.callResult(keyOf('retention-1'))).toMatchObject({
        _tag: 'Settled',
        result: { _tag: 'Decided', decision: { _tag: 'Completed' }, nativeExit: { _tag: 'Code', code: 0 }, retention: 'lost' },
      });
    }).pipe(Effect.provide(composed(directory)));
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
