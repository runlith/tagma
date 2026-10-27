import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { HostByteRecords } from './registry/reads';
import { HostLifecycle } from './registry/shutdown';
import { ExecutionStop } from './registry/stops';
import type { HostClaim } from './registry/state';
import type { VolumeReading } from './RecordVolume';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const profile = runtimeProfile({ executions: 2, transports: ['pipes'] });
const agent = principalOf('agent');
const PLENTY: VolumeReading = { total: 1_000_000_000_000, available: 1_000_000_000_000 };

const logicOver = <S>(directory: string, platform: Context.Context<S>, volume: { reading: VolumeReading }) =>
  ExecutionRegistry.layer({ volumeOf: () => Effect.sync(() => volume.reading) }).pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(
      Layer.unwrap(Effect.map(sharedPool, (pool) => hostState(join(directory, 'executions.sqlite'), registrationOf(directory), pool))).pipe(
        Layer.provideMerge(ExecutionCapacity.layer(profile)),
      ),
    ),
    Layer.provideMerge(Layer.succeedContext(platform)),
    Layer.provideMerge(hostSpawner),
  );

const claimed = Effect.fnUntraced(function* (name: string) {
  const custodian = yield* Custodian;
  const current = yield* custodian.current();
  const connection = connectionOf(name);
  const taken = yield* custodian.take(
    keyOf(`${name}-take`),
    current._tag === 'Settled' ? current.custody.revision : 0,
    connection,
    'custodian',
  );
  return { connection, epoch: taken.standing.epoch, role: 'custodian' } satisfies HostClaim;
});

const printing = (text: string): LaunchRequest => ({
  command: { program: '/bin/sh', args: ['-c', `printf '${text}'`], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  admission: {
    origin: { scope: 'project:1', owner: 'agent-1', cohort: 'wave-1' },
    limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
    policyIdentity: 'policy-1',
  },
});

const shelved = Effect.fnUntraced(function* (claim: HostClaim, name: string, text: string) {
  const executions = yield* Executions;
  const records = yield* HostByteRecords;
  const answer = yield* executions.start(claim, keyOf(name), printing(text));
  if (answer._tag !== 'Started' && answer._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${answer._tag}`));
  const execution: ExecutionId = answer.execution.execution;
  for (;;) {
    const wake = yield* executions.inventoryChanged();
    if (yield* records.sealed(execution)) return answer.execution;
    yield* wake;
  }
});

const stdout = (ref: ExecutionRef) => ({ ref, stream: 'stdout' as const, offset: byteOffset(0n) });
const keptBytes = Effect.map(
  Effect.flatMap(HostLifecycle, (lifecycle) => lifecycle.status()),
  (status) => status.kept?.bytes ?? 0,
);

it.live('records the previous logic of the generation shelved count against the share and are evicted by it', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'shelf-across-logics-' });
    const platform = yield* Layer.build(testHolder(directory).pipe(Layer.provide(hostSpawner)));
    const volume = { reading: PLENTY };
    const leaving = yield* Layer.build(logicOver(directory, platform, volume));
    const { prior, one } = yield* Effect.gen(function* () {
      const claim = yield* claimed('leaving');
      const prior = yield* shelved(claim, 'prior-start', 'prior\n');
      const one = yield* keptBytes;
      const lifecycle = yield* HostLifecycle;
      const quiesced = yield* lifecycle.quiesce(claim, keyOf('leaving-quiesce'));
      if (quiesced._tag === 'Refused') return yield* Effect.die(new Error(`quiesce refused: ${quiesced.refusal._tag}`));
      yield* lifecycle.yield(quiesced.ticket);
      yield* lifecycle.departed;
      return { prior, one };
    }).pipe(Effect.provide(leaving));
    yield* Effect.gen(function* () {
      const claim = yield* claimed('next');
      volume.reading = { total: 20 * 1024 * 1024, available: 20 * (one + Math.floor(one / 2)) };
      const fresh = yield* shelved(claim, 'fresh-start', 'fresh\n');
      expect(fresh.incarnation).toBe(prior.incarnation);
      const records = yield* HostByteRecords;
      expect(yield* Effect.flip(records.read(stdout(prior), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
      expect((yield* (yield* ExecutionStop).ending(prior.execution))?.retention).toBe('lost');
      expect(new TextDecoder().decode((yield* records.read(stdout(fresh), 4096)).bytes)).toBe('fresh\n');
    }).pipe(Effect.provide(logicOver(directory, platform, volume)));
  }).pipe(Effect.provide(BunServices.layer)),
);
