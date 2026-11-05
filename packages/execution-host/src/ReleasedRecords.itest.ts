import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, PlatformError } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { CustodianEpoch } from '@runlith/executions/protocol/registration';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { InputLanes } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords } from './registry/reads';
import { ExecutionRetirement, HostDisown } from './registry/retention';
import { HostLifecycle } from './registry/shutdown';
import type { HostClaim } from './registry/state';
import { ExecutionStore } from './store/ExecutionStore';
import type { VolumeReading } from './RecordVolume';
import { connectionOf, keyOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { Processes } from './ProcessReader';

const agent = Principal.make('agent-1');
type Origin = { readonly owner?: string; readonly scope?: string };
type LaunchInput = {
  readonly line: string;
  readonly lifetime?: 'command' | 'held' | 'call';
  readonly origin?: Origin;
  readonly input?: boolean;
};
const launchOf = (open: RecordCase, { line, lifetime = 'command', origin = {}, input = false }: LaunchInput): LaunchRequest => {
  const scope = origin.scope ?? open.scope;
  open.scopes.add(scope);
  const shared = {
    command: { program: '/bin/sh', args: ['-c', line], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
    transport: { _tag: 'pipes', stdin: input ? 'pipe' : 'ignore' },
    purpose: 'command',
    target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
    holder: agent,
    origin: agent,
  } as const;
  return lifetime === 'command'
    ? {
        ...shared,
        lifetime,
        admission: {
          origin: { scope, owner: origin.owner ?? 'agent-1', cohort: 'wave-1' },
          limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
          policyIdentity: 'policy-1',
        },
      }
    : { ...shared, lifetime, budget: {} };
};
const PLENTY: VolumeReading = { total: 1_000_000_000_000, available: 1_000_000_000_000 };
type Gate = { readonly entered: Deferred.Deferred<void>; readonly held: Deferred.Deferred<void> };
type Parking = { readonly execution: ExecutionId; readonly gate: Gate };
type Sizing = { record: string | undefined; failures: number };
type Faults = {
  volume: VolumeReading;
  recoveredVolume: VolumeReading | undefined;
  sizing: Sizing | undefined;
  elapsedNanos: bigint;
  release: Parking | undefined;
  shelf: Gate | undefined;
  ledger: Gate | undefined;
  readonly gates: Set<Gate>;
};
type Host = {
  readonly hostExecutions: Executions['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly byteRecords: HostByteRecords['Service'];
  readonly retirement: ExecutionRetirement['Service'];
  readonly lifecycle: HostLifecycle['Service'];
  readonly disowning: HostDisown['Service'];
  readonly bindings: Bindings['Service'];
  readonly lanes: InputLanes['Service'];
  readonly claim: HostClaim;
  readonly faults: Faults;
};
type RecordCase = Host & { readonly scope: string; readonly scopes: Set<string> };
class RecordsHost extends Context.Service<RecordsHost, Host>()('test/ReleasedRecords/Host') {}
const pass = (gate: Gate) => Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.held));
const fixture = Layer.effect(
  RecordsHost,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'released-records-' });
    const faults: Faults = {
      volume: PLENTY,
      recoveredVolume: undefined,
      sizing: undefined,
      elapsedNanos: 0n,
      release: undefined,
      shelf: undefined,
      ledger: undefined,
      gates: new Set(),
    };
    const records = `${directory}/records/`;
    const reclaimingFiles = Layer.succeed(FileSystem.FileSystem, {
      ...files,
      stat: (path) => {
        const sizing = faults.sizing;
        const record = path.startsWith(records) && !path.slice(records.length).includes('/');
        if (sizing === undefined || !record || (sizing.record ?? path) !== path || sizing.failures <= 0) return files.stat(path);
        sizing.record = path;
        sizing.failures -= 1;
        return Effect.fail(PlatformError.systemError({ _tag: 'Unknown', module: 'FileSystem', method: 'stat', pathOrDescriptor: path }));
      },
      remove: Effect.fnUntraced(function* (path, options) {
        yield* files.remove(path, options);
        if (options?.recursive === true && path.startsWith(`${directory}/records/`) && faults.recoveredVolume !== undefined) {
          faults.volume = faults.recoveredVolume;
          faults.recoveredVolume = undefined;
        }
      }),
    });
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 4, transports: ['pipes'] }))),
    );
    const store = Layer.effect(
      ExecutionStore,
      Effect.gen(function* () {
        const real = yield* ExecutionStore;
        return ExecutionStore.of({
          ...real,
          executionOf: Effect.fnUntraced(function* (execution) {
            const parking = faults.release;
            if (parking?.execution === execution) {
              faults.release = undefined;
              yield* pass(parking.gate);
            }
            return yield* real.executionOf(execution);
          }),
          sealRecordBytes: Effect.fnUntraced(function* (incarnation, bytes) {
            const gate = faults.shelf;
            if (gate !== undefined) {
              faults.shelf = undefined;
              yield* pass(gate);
            }
            return yield* real.sealRecordBytes(incarnation, bytes);
          }),
          retiredLedger: Effect.fnUntraced(function* () {
            const gate = faults.ledger;
            if (gate !== undefined) {
              faults.ledger = undefined;
              yield* pass(gate);
            }
            return yield* real.retiredLedger();
          }),
        });
      }),
    ).pipe(Layer.provideMerge(state));
    const owners = ExecutionRegistry.layer({ volumeOf: () => Effect.sync(() => faults.volume) }).pipe(
      Layer.provide(reclaimingFiles),
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(store),
      Layer.provide(Layer.effectContext(Effect.map(Layer.build(testHolder(directory)), Context.omit(Processes)))),
      Layer.provide(hostSpawner),
    );
    const context = yield* Layer.build(owners);
    return yield* Effect.gen(function* () {
      const custodian = yield* Custodian;
      const connection = connectionOf('connection-host');
      const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
      return {
        hostExecutions: yield* Executions,
        stops: yield* ExecutionStop,
        byteRecords: yield* HostByteRecords,
        retirement: yield* ExecutionRetirement,
        lifecycle: yield* HostLifecycle,
        disowning: yield* HostDisown,
        bindings: yield* Bindings,
        lanes: yield* InputLanes,
        claim: { connection, epoch: taken.standing.epoch, role: 'custodian' },
        faults,
      } satisfies Host;
    }).pipe(Effect.provide(context));
  }),
).pipe(Layer.provideMerge(BunServices.layer));
const withHost = <A, E, R>(body: (host: RecordCase) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.map(RecordsHost, (host): RecordCase => ({ ...host, scope: crypto.randomUUID(), scopes: new Set() })),
    (host) =>
      Clock.clockWith((clock) =>
        body(host).pipe(
          Effect.provideService(Clock.Clock, {
            currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
            currentTimeMillis: clock.currentTimeMillis,
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            currentTimeNanos: clock.currentTimeNanos,
            sleep: (duration) => clock.sleep(duration),
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe() + host.faults.elapsedNanos,
            monotonicTimeNanos: Effect.map(clock.monotonicTimeNanos, (now) => now + host.faults.elapsedNanos),
          }),
        ),
      ),
    (host) =>
      Effect.gen(function* () {
        for (const gate of host.faults.gates) yield* Deferred.succeed(gate.held, undefined);
        host.faults.gates.clear();
        host.faults.release = undefined;
        host.faults.shelf = undefined;
        host.faults.ledger = undefined;
        host.faults.volume = PLENTY;
        host.faults.recoveredVolume = undefined;
        host.faults.sizing = undefined;
        host.faults.elapsedNanos = 0n;
        for (const scope of host.scopes) yield* host.disowning.disown(host.claim, { scope });
      }),
  );
const gateOf = Effect.fnUntraced(function* (open: Host) {
  const gate = { entered: yield* Deferred.make<void>(), held: yield* Deferred.make<void>() };
  open.faults.gates.add(gate);
  return gate;
});
const until = Effect.fnUntraced(function* <A, E, R>(open: Host, read: Effect.Effect<A, E, R>, ready: (value: A) => boolean) {
  for (;;) {
    const wake = yield* open.hostExecutions.inventoryChanged();
    const value = yield* read;
    if (ready(value)) return value;
    yield* wake;
  }
});
const released = (open: Host, execution: ExecutionId) => until(open, open.byteRecords.sealed(execution), Boolean);
const settled = (open: Host, execution: ExecutionId) =>
  until(
    open,
    open.hostExecutions.summary(execution),
    (summary) => summary !== undefined && summary.state.phase === 'ended' && summary.state.cleanup !== 'pending',
  );
const started = Effect.fnUntraced(function* (open: RecordCase, name: string, input: LaunchInput) {
  const answer = yield* open.hostExecutions.start(open.claim, keyOf(name), launchOf(open, input));
  if (answer._tag !== 'Started' && answer._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${answer._tag}`));
  yield* until(open, open.hostExecutions.summary(answer.execution.execution), (summary) => summary !== undefined);
  return answer.execution;
});
const finishInput = Effect.fnUntraced(function* (open: Host, execution: ExecutionId) {
  const binding = yield* open.bindings.open(agent, open.claim.connection, open.claim.epoch);
  yield* open.lanes.admit(
    execution,
    { binding: binding.id, principal: agent, connection: open.claim.connection, epoch: open.claim.epoch },
    {
      sequence: 0,
      cause: 'typed',
      act: { _tag: 'Write', bytes: new TextEncoder().encode('\n') },
    },
  );
  yield* open.lanes.close(binding.id, agent);
});
const listed = (open: Host) =>
  Effect.map(open.hostExecutions.list(undefined, 4), (page) => page.executions.map((summary) => summary.state.ref.execution));
const keptBytes = (open: Host) => Effect.map(open.lifecycle.status(), (status) => status.kept?.bytes ?? 0);
const stdout = (ref: ExecutionRef) => ({ ref, stream: 'stdout' as const, offset: byteOffset(0n) });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

layer(fixture, { excludeTestServices: true })('released records', (it) => {
  it.effect('an ended measured command leaves the live map while its bytes, summary, stop and accounting remain readable', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const opening = yield* open.hostExecutions.inventoryRevision();
        const ref = yield* started(open, 'op-released-one', { line: "printf 'hello\\n'" });
        yield* released(open, ref.execution);
        expect(yield* listed(open)).not.toContain(ref.execution);
        expect(yield* open.hostExecutions.changes(opening, 4)).toMatchObject({ _tag: 'Changed', left: [{ execution: ref.execution }] });
        const read = yield* open.byteRecords.read(stdout(ref), 4096);
        expect(text(read.bytes)).toBe('hello\n');
        expect(read.modes._tag).toBe('Unavailable');
        const summary = yield* open.hostExecutions.summary(ref.execution);
        expect(summary?.state).toMatchObject({ phase: 'ended', cleanup: 'complete' });
        const ending = yield* open.stops.ending(ref.execution);
        const stopped = yield* open.stops.stop(open.claim, keyOf('op-released-one-stop'), ref.execution, 'explicit-stop', 'signal');
        expect(stopped).toMatchObject({ execution: ref, cleanup: 'complete', operation: keyOf('op-released-one-stop') });
        expect(ending?.cost).toEqual(stopped.cost);
        expect(summary?.cost).toEqual(stopped.cost);
        expect(summary?.cost?._tag).toBe('Measured');
        expect((yield* open.lifecycle.status()).kept?.records).toBeGreaterThanOrEqual(1);
      }),
    ),
  );

  it.effect('keeps an ended command live until its byte reader scope closes', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const ref = yield* started(open, 'op-released-read', { line: "read gate; printf 'late\\n'", input: true });
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* open.byteRecords.openReader(ref.execution, 'stdout', byteOffset(0n));
            yield* finishInput(open, ref.execution);
            yield* settled(open, ref.execution);
            expect(yield* open.byteRecords.sealed(ref.execution)).toBe(false);
            expect(yield* listed(open)).toContain(ref.execution);
          }),
        );
        yield* released(open, ref.execution);
        expect(text((yield* open.byteRecords.read(stdout(ref), 4096)).bytes)).toBe('late\n');
      }),
    ),
  );

  it.effect('keeps ended call and held work until their callers retire them', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const call = yield* started(open, 'op-released-call', { line: 'exit 0', lifetime: 'call' });
        const held = yield* started(open, 'op-released-held', { line: 'exit 0', lifetime: 'held' });
        yield* settled(open, call.execution);
        yield* settled(open, held.execution);
        const after = yield* started(open, 'op-released-after-call', { line: 'exit 0' });
        yield* released(open, after.execution);
        const list = yield* listed(open);
        expect(list).toContain(call.execution);
        expect(list).toContain(held.execution);
        expect(yield* open.byteRecords.sealed(call.execution)).toBe(false);
        expect(yield* open.byteRecords.sealed(held.execution)).toBe(false);
        expect((yield* open.retirement.retire(open.claim, keyOf('op-released-call-retire'), call.execution))._tag).toBe('Forgotten');
        expect((yield* open.retirement.retire(open.claim, keyOf('op-released-held-retire'), held.execution))._tag).toBe('Forgotten');
      }),
    ),
  );

  it.effect('callers crossing an in-flight release find its completed retained bytes instead of an absent execution', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const ref = yield* started(open, 'op-released-race', { line: "read gate; printf 'raced\\n'", input: true });
        const gate = yield* gateOf(open);
        open.faults.release = { execution: ref.execution, gate };
        yield* finishInput(open, ref.execution);
        yield* Deferred.await(gate.entered);
        expect((yield* Effect.flip(Effect.scoped(open.byteRecords.openReader(ref.execution, 'stdout', byteOffset(0n)))))._tag).toBe(
          'ExecutionRefused',
        );
        const sealed = yield* Effect.forkChild(open.byteRecords.sealed(ref.execution));
        const read = yield* Effect.forkChild(open.byteRecords.read(stdout(ref), 4096));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate.held, undefined);
        expect(yield* Fiber.join(sealed)).toBe(true);
        expect(text((yield* Fiber.join(read)).bytes)).toBe('raced\n');
      }),
    ),
  );

  it.effect('a summary and read crossing shelf publication still find the ended execution and kept bytes', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = yield* gateOf(open);
        open.faults.shelf = gate;
        const answer = yield* open.hostExecutions.start(
          open.claim,
          keyOf('op-released-shelving'),
          launchOf(open, { line: "printf 'shelved\\n'" }),
        );
        if (answer._tag !== 'Accepted' && answer._tag !== 'Started') return yield* Effect.die(new Error(`start: ${answer._tag}`));
        const ref = answer.execution;
        yield* Deferred.await(gate.entered);
        expect((yield* open.hostExecutions.summary(ref.execution))?.state.phase).toBe('ended');
        const read = yield* Effect.forkChild(open.byteRecords.read(stdout(ref), 4096));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate.held, undefined);
        expect(text((yield* Fiber.join(read)).bytes)).toBe('shelved\n');
      }),
    ),
  );

  it.effect('disowning an owner removes only its existing and subsequent kept records and refuses foreign custody', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const mine = yield* started(open, 'op-disown-mine', { line: "printf 'mine\\n'", origin: { owner: 'thread:gone' } });
        const theirs = yield* started(open, 'op-disown-theirs', { line: "printf 'theirs\\n'", origin: { owner: 'thread:stays' } });
        yield* released(open, mine.execution);
        yield* released(open, theirs.execution);
        expect(yield* open.disowning.disown(open.claim, { owner: 'thread:gone' })).toEqual({ retired: 1 });
        const later = yield* started(open, 'op-disown-later', { line: "printf 'later\\n'", origin: { owner: 'thread:gone' } });
        yield* until(open, open.stops.ending(later.execution), (ending) => ending?.retention === 'lost');
        expect(yield* Effect.flip(open.byteRecords.read(stdout(mine), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        expect((yield* open.stops.ending(mine.execution))?.retention).toBe('lost');
        expect(text((yield* open.byteRecords.read(stdout(theirs), 4096)).bytes)).toBe('theirs\n');
        expect(yield* Effect.flip(open.byteRecords.read(stdout(later), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        expect(yield* open.byteRecords.sealed(later.execution)).toBe(false);
        expect(
          (yield* Effect.result(
            open.disowning.disown({ ...open.claim, epoch: CustodianEpoch.make(open.claim.epoch + 1) }, { owner: 'thread:stays' }),
          ))._tag,
        ).toBe('Failure');
      }),
    ),
  );

  it.effect('disowning a project removes every owner in that project without removing another project', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const removed = yield* started(open, 'op-scope-removed', { line: "printf 'removed\\n'", origin: { scope: 'project:9' } });
        const other = yield* started(open, 'op-scope-other', { line: "printf 'other\\n'", origin: { scope: 'project:8' } });
        yield* released(open, removed.execution);
        yield* released(open, other.execution);
        expect(yield* open.disowning.disown(open.claim, { scope: 'project:9' })).toEqual({ retired: 1 });
        expect(yield* Effect.flip(open.byteRecords.read(stdout(removed), 4096))).toMatchObject({
          _tag: 'RecordReadFailed',
          act: 'missing',
        });
        expect(text((yield* open.byteRecords.read(stdout(other), 4096)).bytes)).toBe('other\n');
      }),
    ),
  );

  it.effect('overlapping releases do not reclaim a second unread result after the critical deficit has been covered', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const first = yield* started(open, 'op-overlap-first', { line: "read gate; printf 'first\\n'", input: true });
        const second = yield* started(open, 'op-overlap-second', { line: "read gate; printf 'second\\n'", input: true });
        open.faults.volume = { total: 20 * 1024 * 1024, available: 0 };
        open.faults.recoveredVolume = PLENTY;
        const gate = yield* gateOf(open);
        open.faults.shelf = gate;
        yield* finishInput(open, first.execution);
        yield* Deferred.await(gate.entered);
        yield* finishInput(open, second.execution);
        yield* settled(open, second.execution);
        yield* Deferred.succeed(gate.held, undefined);
        yield* until(open, listed(open), (executions) => !executions.includes(first.execution) && !executions.includes(second.execution));
        yield* open.byteRecords.sealed(first.execution);
        yield* open.byteRecords.sealed(second.execution);
        expect((yield* open.stops.ending(first.execution))?.retention).toBe('lost');
        expect(text((yield* open.byteRecords.read(stdout(second), 4096)).bytes)).toBe('second\n');
      }),
    ),
  );

  it.effect('unread output whose grace elapsed becomes reclaimable on the next pressured release', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const old = yield* started(open, 'op-unread-expired', { line: "printf 'old\\n'" });
        yield* released(open, old.execution);
        open.faults.elapsedNanos = 10n * 60n * 1_000_000_000n;
        open.faults.volume = { total: 20 * 1024 * 1024, available: 30 * (yield* keptBytes(open)) };
        const fresh = yield* started(open, 'op-unread-fresh', { line: "printf 'fresh\\n'" });
        yield* released(open, fresh.execution);
        expect(yield* Effect.flip(open.byteRecords.read(stdout(old), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        expect(text((yield* open.byteRecords.read(stdout(fresh), 4096)).bytes)).toBe('fresh\n');
      }),
    ),
  );

  it.effect('critical free space can reclaim even unread output and reports the lost record', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        open.faults.volume = { total: 20 * 1024 * 1024, available: 0 };
        const ref = yield* started(open, 'op-unread-critical', { line: "printf 'critical\\n'" });
        yield* until(open, listed(open), (executions) => !executions.includes(ref.execution));
        expect(yield* Effect.flip(open.byteRecords.read(stdout(ref), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        expect((yield* open.stops.ending(ref.execution))?.retention).toBe('lost');
      }),
    ),
  );

  it.effect('output read once stays readable across later releases while other files hold the volume below its reserve', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        open.faults.volume = { total: 1_000_000_000_000, available: 34_000_000_000 };
        const first = yield* started(open, 'op-full-volume-first', { line: "printf 'first\\n'" });
        yield* released(open, first.execution);
        expect(text((yield* open.byteRecords.read(stdout(first), 4096)).bytes)).toBe('first\n');
        const second = yield* started(open, 'op-full-volume-second', { line: "printf 'second\\n'" });
        yield* released(open, second.execution);
        expect(text((yield* open.byteRecords.read(stdout(first), 4096)).bytes)).toBe('first\n');
        expect((yield* open.stops.ending(first.execution))?.retention).toBe('retained');
      }),
    ),
  );

  it.effect('a release below the volume reserve seals its record while the retired generations are still being reclaimed', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const reclaim = yield* gateOf(open);
        open.faults.ledger = reclaim;
        open.faults.volume = { total: 1_000_000_000_000, available: 34_000_000_000 };
        const ref = yield* started(open, 'op-reclaim-aside', { line: "printf 'aside\\n'" });
        yield* released(open, ref.execution);
        yield* Deferred.await(reclaim.entered);
        expect(text((yield* open.byteRecords.read(stdout(ref), 4096)).bytes)).toBe('aside\n');
      }),
    ),
  );

  it.effect('a record whose sizing failed is sized again on a later release and counts against the share', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const first = yield* started(open, 'op-resized-first', { line: "printf 'first\\n'" });
        yield* released(open, first.execution);
        const one = yield* keptBytes(open);
        open.faults.sizing = { record: undefined, failures: 2 };
        const unsized = yield* started(open, 'op-resized-unsized', { line: "printf 'unsized\\n'" });
        yield* released(open, unsized.execution);
        expect(yield* keptBytes(open)).toBe(one);
        yield* open.byteRecords.read(stdout(unsized), 4096);
        open.faults.volume = { total: 20 * 1024 * 1024, available: 20 * (2 * one + Math.floor(one / 2)) };
        const later = yield* started(open, 'op-resized-later', { line: "printf 'later\\n'" });
        yield* released(open, later.execution);
        expect((yield* open.stops.ending(unsized.execution))?.retention).toBe('lost');
        expect(text((yield* open.byteRecords.read(stdout(first), 4096)).bytes)).toBe('first\n');
        expect(text((yield* open.byteRecords.read(stdout(later), 4096)).bytes)).toBe('later\n');
      }),
    ),
  );

  it.effect('a record that cannot be sized is reclaimed once the volume falls below its reserve', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        open.faults.sizing = { record: undefined, failures: Number.POSITIVE_INFINITY };
        const unsized = yield* started(open, 'op-unsizable', { line: "printf 'unsized\\n'" });
        yield* released(open, unsized.execution);
        yield* open.byteRecords.read(stdout(unsized), 4096);
        open.faults.volume = { total: 1_000_000_000_000, available: 34_000_000_000 };
        const later = yield* started(open, 'op-unsizable-later', { line: "printf 'later\\n'" });
        yield* released(open, later.execution);
        expect((yield* open.stops.ending(unsized.execution))?.retention).toBe('lost');
        expect(text((yield* open.byteRecords.read(stdout(later), 4096)).bytes)).toBe('later\n');
      }),
    ),
  );

  it.effect('kept output over its share of free space gives up delivered output before older unread output', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const origin = { scope: 'project:guard' };
        const first = yield* started(open, 'op-guard-first', { line: "printf 'first\\n'", origin });
        yield* released(open, first.execution);
        const one = yield* keptBytes(open);
        const second = yield* started(open, 'op-guard-second', { line: "printf 'second\\n'", origin });
        yield* released(open, second.execution);
        const third = yield* started(open, 'op-guard-third', { line: "printf 'third\\n'", origin });
        yield* released(open, third.execution);
        expect(text((yield* open.byteRecords.read(stdout(third), 4096)).bytes)).toBe('third\n');
        expect(text((yield* open.byteRecords.read(stdout(second), 4096)).bytes)).toBe('second\n');
        const available = 20 * ((yield* keptBytes(open)) + Math.floor(one / 2));
        open.faults.volume = { total: 20 * 1024 * 1024, available };
        const fourth = yield* started(open, 'op-guard-fourth', { line: "printf 'fourth\\n'", origin });
        yield* released(open, fourth.execution);
        open.faults.volume = PLENTY;
        expect(yield* Effect.flip(open.byteRecords.read(stdout(second), 4096))).toMatchObject({ _tag: 'RecordReadFailed', act: 'missing' });
        expect((yield* open.stops.ending(second.execution))?.retention).toBe('lost');
        expect(text((yield* open.byteRecords.read(stdout(first), 4096)).bytes)).toBe('first\n');
        expect(text((yield* open.byteRecords.read(stdout(third), 4096)).bytes)).toBe('third\n');
        expect(text((yield* open.byteRecords.read(stdout(fourth), 4096)).bytes)).toBe('fourth\n');
        expect((yield* open.lifecycle.status()).kept).toMatchObject({ records: 3, reserve: 1024 * 1024, available });
      }),
    ),
  );
});
