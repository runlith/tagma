import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Fiber, FileSystem, Layer } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords } from './registry/reads';
import { ExecutionRetirement } from './registry/retention';
import type { HostClaim } from './registry/state';
import { connectionOf, keyOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const agent = Principal.make('agent-1');
const launchOf = (cwd: string, line: string, lifetime: 'held' | 'call' | 'command'): LaunchRequest => {
  const shared = {
    command: { program: '/bin/sh', args: ['-c', line], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
    transport: { _tag: 'pipes', stdin: 'ignore' },
    purpose: 'command',
    target: { environment: 'environment-1', namespace: 'namespace-1', cwd, dependencies: [] },
    holder: agent,
    origin: agent,
  } as const;
  return lifetime === 'command'
    ? {
        ...shared,
        lifetime,
        admission: {
          origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
          limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
          policyIdentity: 'policy-1',
        },
      }
    : { ...shared, lifetime, budget: {} };
};
const composed = (directory: string) => {
  const state = Layer.unwrap(
    Effect.map(sharedPool, (pool) => hostState(`${directory}/executions.sqlite`, registrationOf(directory), pool)),
  ).pipe(Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 4, transports: ['pipes'] }))));
  return ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(state),
    Layer.provide(testHolder(directory)),
    Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner)),
  );
};

it.live(
  'inventory revisions disclose joins, departures and graded endings without repeating earlier changes, and reset ahead cursors',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'inventory-changes-' });
      yield* Effect.gen(function* () {
        const executions = yield* Executions;
        const stops = yield* ExecutionStop;
        const byteRecords = yield* HostByteRecords;
        const retirement = yield* ExecutionRetirement;
        const custodian = yield* Custodian;
        const connection = connectionOf('connection-host');
        const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
        const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
        const opening = yield* executions.changes(0, 3);
        expect(opening).toMatchObject({ _tag: 'Changed', executions: [], left: [] });
        const running = yield* executions.start(claim, keyOf('op-changes-running'), launchOf(directory, 'sleep 30', 'held'));
        const finishing = yield* executions.start(claim, keyOf('op-changes-held'), launchOf(directory, 'exit 0', 'held'));
        const command = yield* executions.start(claim, keyOf('op-changes-one'), launchOf(directory, 'exit 0', 'command'));
        if (command._tag !== 'Accepted' || running._tag !== 'Started' || finishing._tag !== 'Started')
          return yield* Effect.die(new Error(`start: ${command._tag}/${running._tag}/${finishing._tag}`));
        const execution = command.execution.execution;
        const standing = running.execution.execution;
        const ended = finishing.execution.execution;
        for (;;) {
          const wake = yield* executions.inventoryChanged();
          if (yield* byteRecords.sealed(execution)) break;
          yield* wake;
        }
        for (;;) {
          const changed = yield* executions.changed(ended);
          const state = (yield* executions.summary(ended))?.state;
          if (state?.phase === 'ended' && state.cleanup !== 'pending') break;
          yield* changed;
        }
        const left = yield* executions.changes(opening.revision, 3);
        expect(left._tag).toBe('Changed');
        if (left._tag !== 'Changed') return yield* Effect.die(new Error('the standing inventory revision was reset'));
        expect(left.executions.map((summary) => summary.state.ref.execution).sort()).toEqual([standing, ended].sort());
        expect(left.executions.find((summary) => summary.state.ref.execution === standing)?.state.phase).toBe('running');
        expect(left.executions.find((summary) => summary.state.ref.execution === ended)?.state.phase).toBe('ended');
        expect(left.left).toEqual([command.execution]);
        yield* retirement.retire(claim, keyOf('op-changes-held-retire'), ended);
        const retired = yield* executions.changes(left.revision, 3);
        expect(retired).toMatchObject({ _tag: 'Changed', executions: [], left: [{ execution: ended }] });
        expect(yield* executions.changes(retired.revision, 3)).toMatchObject({ _tag: 'Changed', executions: [], left: [] });
        yield* stops.stop(claim, keyOf('op-changes-running-stop'), standing, 'explicit-stop', 'signal');

        let since = yield* executions.inventoryRevision();
        const graded = yield* executions.start(claim, keyOf('op-changes-graded'), launchOf(directory, 'printf done', 'call'));
        if (graded._tag !== 'Started') return yield* Effect.die(new Error(`start: ${graded._tag}`));
        for (;;) {
          const wake = yield* executions.inventoryChanged();
          const read = yield* executions.changes(since, 3);
          if (read._tag !== 'Changed') return yield* Effect.die(new Error(`changes: ${read._tag}`));
          since = read.revision;
          const state = read.executions.find((summary) => summary.state.ref.execution === graded.execution.execution)?.state;
          if (
            state?.phase === 'ended' &&
            state.cleanup !== 'pending' &&
            state.streams.stdout !== 'open' &&
            state.streams.stderr !== 'open'
          ) {
            expect(state.cleanup).toBe('complete');
            break;
          }
          yield* wake;
        }
        expect((yield* retirement.retire(claim, keyOf('op-changes-graded-retire'), graded.execution.execution))._tag).toBe('Forgotten');
        const revision = yield* executions.inventoryRevision();
        expect(yield* executions.changes(revision + 10, 3)).toMatchObject({ _tag: 'Reset', reason: 'ahead' });
      }).pipe(Effect.provide(composed(directory)));
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
