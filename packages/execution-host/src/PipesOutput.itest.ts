import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Schedule } from 'effect';
import { byteOffset, type Stream } from '@runlith/executions/protocol/record';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords } from './registry/reads';
import type { HostClaim } from './registry/state';
import { connectionOf, hostTestRoot, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });
const agent = principalOf('agent');
const launch: LaunchRequest = {
  command: {
    program: '/bin/sh',
    args: ['-c', 'printf ab; sleep 0.05; printf WX >&2; sleep 0.05; printf cd; sleep 0.05; printf YZ >&2'],
    environment: [],
  },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  budget: {},
};

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner), { excludeTestServices: true })('pipes output', (it) => {
  it.effect(
    'a child writing to stdout and stderr in turn leaves output holding all of both, each in its own order, and both streams unchanged',
    Effect.fnUntraced(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = hostTestRoot();
      yield* fs.makeDirectory(root, { recursive: true });
      const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'execution-pipes-output-' });
      const registry = ExecutionRegistry.layer().pipe(
        Layer.provideMerge(Bindings.layer),
        Layer.provideMerge(
          hostState(join(directory, 'executions.sqlite'), registrationOf(directory), yield* sharedPool).pipe(
            Layer.provideMerge(ExecutionCapacity.layer(profile)),
          ),
        ),
        Layer.provide(testHolder(directory)),
      );
      const context = yield* Layer.build(registry);
      const outcome = yield* Effect.gen(function* () {
        const custodian = yield* Custodian;
        const executions = yield* Executions;
        const stops = yield* ExecutionStop;
        const records = yield* HostByteRecords;
        const connection = connectionOf('connection-host');
        const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
        const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
        const started = yield* executions.start(claim, keyOf('pipes-output-1'), launch);
        if (started._tag !== 'Started') return yield* Effect.die(new Error('the alternating child did not start'));
        const ref: ExecutionRef = started.execution;
        yield* stops
          .ending(ref.execution)
          .pipe(Effect.repeat({ while: (ending) => ending === undefined, schedule: Schedule.spaced('10 millis') }));
        const text = (stream: Stream) =>
          Effect.map(records.read({ ref, stream, offset: byteOffset(0n) }, 64), (read) => new TextDecoder().decode(read.bytes));
        const summary = yield* executions.summary(ref.execution);
        return {
          output: yield* text('output'),
          stdout: yield* text('stdout'),
          stderr: yield* text('stderr'),
          ending: summary?.streams.find((positions) => positions.stream === 'output')?.ending,
        };
      }).pipe(Effect.provide(context));
      expect(outcome.stdout).toBe('abcd');
      expect(outcome.stderr).toBe('WXYZ');
      expect(outcome.output.replace(/[A-Z]/g, '')).toBe('abcd');
      expect(outcome.output.replace(/[a-z]/g, '')).toBe('WXYZ');
      expect(outcome.ending).toBe('eof');
    }),
  );
});
