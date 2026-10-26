import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Schedule } from 'effect';
import { byteOffset, offsetValue, type ByteCursor } from '@runlith/executions/protocol/record';
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
import { connectionOf, hostTestRoot, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });
const lines = Math.ceil((profile.execution.output.retainedBytes * 3) / 51);
const agent = principalOf('agent');
const launch: LaunchRequest = {
  command: { program: '/usr/bin/awk', args: [`BEGIN{for(i=0;i<${lines};i++) printf "%050d\\n", i}`], environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  budget: {},
};

const streamText = (from: bigint, length: number): string => {
  const prefix = Number(from % 51n);
  let out = '';
  let line = Number(from / 51n);
  while (out.length < prefix + length) out += `${String(line++).padStart(50, '0')}\n`;
  return out.slice(prefix, prefix + length);
};

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner), { excludeTestServices: true })(
  'reads over an evicted range',
  (it) => {
    it.effect(
      'distinguishes retained bytes, an eviction gap, the ended frontier and a forgotten record',
      Effect.fnUntraced(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = hostTestRoot();
        yield* fs.makeDirectory(root, { recursive: true });
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'execution-evicted-read-' });
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
        yield* Effect.gen(function* () {
          const custodian = yield* Custodian;
          const executions = yield* Executions;
          const stops = yield* ExecutionStop;
          const records = yield* HostByteRecords;
          const retirement = yield* ExecutionRetirement;
          const connection = connectionOf('connection-host');
          const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
          const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
          const started = yield* executions.start(claim, keyOf('evicted-read-1'), launch);
          if (started._tag !== 'Started') return yield* Effect.die(new Error('the flood child did not start'));
          const ref = started.execution;
          yield* stops
            .ending(ref.execution)
            .pipe(Effect.repeat({ while: (ending) => ending === undefined, schedule: Schedule.spaced('10 millis') }));
          const summary = yield* executions.summary(ref.execution);
          const stdout = summary?.streams.find((positions) => positions.stream === 'stdout');
          if (stdout === undefined) return yield* Effect.die(new Error('the flood child left no stdout'));
          const retainedFrom = offsetValue(stdout.retainedFrom);
          const durableThrough = offsetValue(stdout.durableThrough);
          expect(retainedFrom).toBeGreaterThan(0n);
          const cursor = (offset: bigint): ByteCursor => ({ ref, stream: 'stdout', offset: byteOffset(offset) });
          const retained = yield* records.read(cursor(retainedFrom), 100);
          expect(new TextDecoder().decode(retained.bytes)).toBe(streamText(retainedFrom, 100));
          expect(retained.range.gap).toBe(false);
          expect(offsetValue(retained.range.next)).toBe(retainedFrom + 100n);
          const evicted = yield* records.read(cursor(0n), 1024);
          expect(evicted.bytes.length).toBe(0);
          expect(evicted.range.gap).toBe(true);
          expect(offsetValue(evicted.range.next)).toBe(retainedFrom);
          expect(offsetValue(evicted.range.retainedFrom)).toBe(retainedFrom);
          const gap = yield* records.read(cursor(retainedFrom - 100n), 1024);
          expect(gap.bytes.length).toBe(0);
          expect(gap.range.gap).toBe(true);
          expect(offsetValue(gap.range.next)).toBe(retainedFrom);
          const survivors = yield* records.read(cursor(offsetValue(gap.range.next)), 100);
          expect(new TextDecoder().decode(survivors.bytes)).toBe(streamText(retainedFrom, 100));
          expect(survivors.range.gap).toBe(false);
          expect(offsetValue(survivors.range.next)).toBe(retainedFrom + 100n);
          const frontier = yield* records.read(cursor(durableThrough), 1024);
          expect(frontier.bytes.length).toBe(0);
          expect(frontier.range.gap).toBe(false);
          expect(offsetValue(frontier.range.next)).toBe(durableThrough);
          const past = yield* Effect.flip(records.read(cursor(durableThrough + 100n), 1024));
          expect(past._tag).toBe('CursorRefused');
          expect((yield* retirement.forget(ref.execution))._tag).toBe('Forgotten');
          const forgotten = yield* Effect.flip(records.read(cursor(retainedFrom), 100));
          expect(forgotten).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        }).pipe(Effect.provide(context));
      }),
    );
  },
);
