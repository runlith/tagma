import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Schedule } from 'effect';
import type { CommandAdmission } from '@runlith/executions/protocol/command';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionStop } from './registry/stops';
import type { HostClaim } from './registry/state';
import { connectionOf, hostTestRoot, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { groupStanding } from './posix/testing/processes';
import { runtimeProfile } from './runtimeFixture';

const agent = principalOf('agent-1');
const admissionOf = (): CommandAdmission => ({
  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
  limits: { executionMs: 60_000, executionCeilingMs: 300_000 },
  policyIdentity: 'policy-1',
});
const commandOf = (cwd: string, release: string): LaunchRequest => ({
  command: {
    program: '/bin/sh',
    args: ['-c', '(while [ ! -f "$1" ]; do sleep 0.01; done) </dev/null >/dev/null 2>&1 &', 'compiler', release],
    environment: [{ name: 'PATH', value: '/usr/bin:/bin' }],
    cwd,
  },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd, dependencies: [] },
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
  'an ended command and its retained group',
  (it) => {
    it.effect(
      'ends the group before recording a complete ending and distinguishes a later remeasurement',
      Effect.fnUntraced(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = hostTestRoot();
        yield* fs.makeDirectory(root, { recursive: true });
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'compiler-qualification-' });
        const release = join(directory, 'release');
        const context = yield* Layer.build(registry(directory));
        yield* Effect.addFinalizer(() => fs.writeFileString(release, '').pipe(Effect.orDie));
        yield* Effect.gen(function* () {
          const custodian = yield* Custodian;
          const executions = yield* Executions;
          const stops = yield* ExecutionStop;
          const connection = connectionOf('connection-host');
          const taken = yield* custodian.take(keyOf('take-qualify'), 0, connection, 'custodian');
          const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
          const started = yield* executions.start(claim, keyOf('native-descendant'), commandOf(directory, release));
          expect(started._tag).toBe('Accepted');
          if (started._tag !== 'Accepted') return;
          const receipt = yield* stops.ending(started.execution.execution).pipe(
            Effect.repeat({
              while: (ending) => ending === undefined,
              schedule: Schedule.spaced('10 millis'),
            }),
          );
          if (receipt === undefined) return yield* Effect.die(new Error('the command ended without a receipt'));
          expect(receipt.nativeExit).toEqual({ _tag: 'Code', code: 0 });
          expect(receipt.cleanup).toBe('complete');
          const group = receipt.confirmed.find((resource) => resource.relation === 'work');
          expect(group).toBeDefined();
          if (group === undefined) return yield* Effect.die(new Error('the ending measured no owned group'));
          expect(groupStanding(group.pid)).toBe('gone');
          expect(group.step).toBe('terminate');
          expect(receipt.measurement).toBe('recorded');
          const fresh = yield* stops.ending(started.execution.execution, true);
          expect(fresh?.measurement).toBe('remeasured');
          expect(fresh?.residual).toEqual(receipt.residual);
          expect(fresh?.unverifiable).toEqual(receipt.unverifiable);
          expect(fresh?.cleanup).toBe(receipt.cleanup);
          expect(fresh?.nativeExit).toEqual(receipt.nativeExit);
        }).pipe(Effect.provide(context));
      }),
    );
  },
);
