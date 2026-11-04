import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Fiber, FileSystem, Layer, Queue, Schedule, Scope, Exit } from 'effect';
import type { CommandAdmission } from '@runlith/executions/protocol/command';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CommandEntry, CommandQuery, CommandWatermark } from '@runlith/executions/protocol/inventory';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { Registration } from '@runlith/executions/protocol/registration';
import { byteOffset } from '@runlith/executions/protocol/record';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { HostCommands } from './registry/inventory';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords } from './registry/reads';
import type { HostClaim } from './registry/state';
import { ExecutionStore } from './store/ExecutionStore';
import { StoreUnreadable } from './store/errors';
import { connectionOf, keyOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';

const agent = Principal.make('agent-1');
const admission: CommandAdmission = {
  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
  limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
  policyIdentity: 'policy-1',
};
const commandOf = (line: string): LaunchRequest => ({
  command: { program: '/bin/sh', args: ['-c', line], environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  admission,
});
type Gate = { readonly held: Deferred.Deferred<void>; readonly entered: Deferred.Deferred<void> };
type Faults = {
  parking: Gate | undefined;
  running: Deferred.Deferred<void> | undefined;
  childless: Deferred.Deferred<void> | undefined;
  unreadable: boolean;
};
type Host = {
  readonly hostExecutions: Executions['Service'];
  readonly requests: ExecutionRequest['Service'];
  readonly hostCommands: HostCommands['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly byteRecords: HostByteRecords['Service'];
  readonly claim: HostClaim;
  readonly faults: Faults;
  readonly close: Effect.Effect<void>;
};
type HostInput = { readonly directory: string; readonly registration: Registration; readonly key: string; readonly expected: number };
const openHost = Effect.fnUntraced(function* ({ directory, registration, key, expected }: HostInput) {
  const faults: Faults = { parking: undefined, running: undefined, childless: undefined, unreadable: false };
  const state = hostState(`${directory}/executions.sqlite`, registration, yield* sharedPool).pipe(
    Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 12, transports: ['pipes'] }))),
  );
  const store = Layer.effect(
    ExecutionStore,
    Effect.gen(function* () {
      const real = yield* ExecutionStore;
      return ExecutionStore.of({
        ...real,
        commandPage: (query) =>
          Effect.suspend(() =>
            faults.unreadable
              ? Effect.fail(new StoreUnreadable({ record: 'execution', key: 'inventory', reason: 'the case armed an unreadable walk' }))
              : real.commandPage(query),
          ),
        commandsAt: (executions) =>
          Effect.suspend(() =>
            faults.unreadable
              ? Effect.fail(new StoreUnreadable({ record: 'execution', key: 'inventory', reason: 'the case armed an unreadable walk' }))
              : real.commandsAt(executions),
          ),
        recordState: Effect.fnUntraced(function* (state, native) {
          const hold =
            state.phase === 'running'
              ? faults.running
              : state.phase === 'ended' && state.record === 'unavailable'
                ? faults.childless
                : undefined;
          if (hold !== undefined) yield* Deferred.await(hold);
          return yield* real.recordState(state, native);
        }),
      });
    }),
  ).pipe(Layer.provideMerge(state));
  const files = Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({
        ...real,
        makeDirectory: (path, options) =>
          Effect.suspend(() => {
            const gate = path.startsWith(`${directory}/records`) ? faults.parking : undefined;
            return Effect.andThen(
              gate === undefined ? Effect.void : Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.held)),
              real.makeDirectory(path, options),
            );
          }),
      });
    }),
  ).pipe(Layer.provide(BunFileSystem.layer));
  const layer = ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(store),
    Layer.provide(testHolder(directory)),
    Layer.provideMerge(files),
    Layer.provide(hostSpawner),
    Layer.provide(BunServices.layer),
  );
  const scope = yield* Scope.fork(yield* Effect.scope);
  const context = yield* Scope.provide(Layer.build(layer), scope);
  const host = yield* Effect.gen(function* () {
    const custodian = yield* Custodian;
    const connection = connectionOf('connection-host');
    const taken = yield* custodian.take(keyOf(key), expected, connection, 'custodian');
    const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
    const close = Effect.gen(function* () {
      if (faults.parking !== undefined) yield* Deferred.succeed(faults.parking.held, undefined);
      if (faults.running !== undefined) yield* Deferred.succeed(faults.running, undefined);
      if (faults.childless !== undefined) yield* Deferred.succeed(faults.childless, undefined);
      yield* Scope.close(scope, Exit.void);
    });
    return {
      hostExecutions: yield* Executions,
      requests: yield* ExecutionRequest,
      hostCommands: yield* HostCommands,
      stops: yield* ExecutionStop,
      byteRecords: yield* HostByteRecords,
      claim,
      faults,
      close,
    } satisfies Host;
  }).pipe(Effect.provide(context));
  yield* Effect.addFinalizer(() => host.close);
  return host;
});
const parked = <A, E, R>(host: Host, body: (gate: Gate) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const gate = { held: yield* Deferred.make<void>(), entered: yield* Deferred.make<void>() };
      host.faults.parking = gate;
      return gate;
    }),
    body,
    (gate) =>
      Effect.sync(() => {
        host.faults.parking = undefined;
      }).pipe(Effect.andThen(Deferred.succeed(gate.held, undefined))),
  );
const accept = Effect.fnUntraced(function* (host: Host, key: string, line: string) {
  const started = yield* host.hostExecutions.start(host.claim, keyOf(key), commandOf(line));
  if (started._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${started._tag}`));
  return started.execution;
});
const queryOf = (over: Partial<CommandQuery> = {}): CommandQuery => ({ limit: 12, ...over });
const pageOf = Effect.fnUntraced(function* (host: Host, query = queryOf()) {
  const answer = yield* host.hostCommands.inventory(query);
  if (answer._tag !== 'Page') return yield* Effect.die(new Error(`inventory: ${answer._tag}`));
  return answer.page;
});
const rowOf = (commands: readonly CommandEntry[], execution: ExecutionId) =>
  commands.find((entry) => entry.state.ref.execution === execution);
const until = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.repeat(read, { until: done, schedule: Schedule.spaced('1 millis') });

it.live('the command inventory retains admitted and childless work, opens readers across setup, and pages only the selected question', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-inventory-' });
    const host = yield* openHost({ directory, registration: registrationOf(directory), key: 'take-host', expected: 0 });
    const { hostExecutions, hostCommands, stops, byteRecords, claim } = host;
    yield* parked(
      host,
      Effect.fnUntraced(function* (gate) {
        const queued = yield* accept(host, 'op-queued', 'echo queued');
        yield* Deferred.await(gate.entered);
        const row = rowOf((yield* pageOf(host)).commands, queued.execution);
        expect(row?.state.phase).toBe('queued');
        expect(row?.admission.origin).toEqual(admission.origin);
        expect(row?.deadline.revision).toBe(0);
        expect(row?.ending).toBeUndefined();
        yield* stops.stop(claim, keyOf('op-queued-release'), queued.execution, 'explicit-stop', 'signal');
      }),
    );
    yield* Effect.scoped(
      parked(
        host,
        Effect.fnUntraced(function* (gate) {
          const ref = yield* accept(host, 'op-queued-output', 'printf acquired');
          yield* Deferred.await(gate.entered);
          const entered = yield* Deferred.make<void>();
          const opening = yield* Effect.forkChild(
            Effect.andThen(Deferred.succeed(entered, undefined), byteRecords.openReader(ref.execution, 'stdout', byteOffset(0n))),
          );
          yield* Deferred.await(entered);
          yield* Deferred.succeed(gate.held, undefined);
          const reader = yield* Fiber.join(opening);
          yield* byteRecords.grant(ref.execution, reader, 64);
          yield* byteRecords.awaitBytes(ref.execution, reader);
          expect(new TextDecoder().decode((yield* byteRecords.pull(ref.execution, reader)).bytes)).toBe('acquired');
        }),
      ),
    );
    yield* Effect.scoped(
      parked(
        host,
        Effect.fnUntraced(function* (gate) {
          const ref = yield* accept(host, 'op-cancelled-output', 'printf never-runs');
          yield* Deferred.await(gate.entered);
          const entered = yield* Deferred.make<void>();
          const opening = yield* Effect.forkChild(
            Effect.flip(
              Effect.andThen(Deferred.succeed(entered, undefined), byteRecords.openReader(ref.execution, 'stdout', byteOffset(0n))),
            ),
          );
          yield* Deferred.await(entered);
          yield* stops.stop(claim, keyOf('op-cancelled-output-stop'), ref.execution, 'explicit-stop', 'signal');
          expect(yield* Fiber.join(opening)).toMatchObject({ _tag: 'ExecutionUnknown' });
        }),
      ),
    );
    yield* parked(
      host,
      Effect.fnUntraced(function* (gate) {
        const ref = yield* accept(host, 'op-childless', 'echo never-runs');
        yield* Deferred.await(gate.entered);
        yield* stops.stop(claim, keyOf('op-childless-stop'), ref.execution, 'explicit-stop', 'signal');
        const row = rowOf((yield* pageOf(host)).commands, ref.execution);
        const measured = yield* stops.ending(ref.execution);
        expect(row?.state.phase).toBe('ended');
        if (measured === undefined) return yield* Effect.die(new Error('the childless ending was not measured'));
        const { measurement: _measurement, ...receipt } = measured;
        expect(row?.ending).toEqual(receipt);
        expect(row?.ending?.cost._tag).toBe('Unmeasured');
      }),
    );
    yield* parked(
      host,
      Effect.fnUntraced(function* (gate) {
        const queued = yield* accept(host, 'op-wake-queued', 'echo never-runs');
        yield* Deferred.await(gate.entered);
        const held = yield* Deferred.make<void>();
        host.faults.childless = held;
        yield* Effect.addFinalizer(() => Deferred.succeed(held, undefined));
        const seen = yield* Queue.unbounded<string>();
        const reader = yield* Effect.forkChild(
          Effect.gen(function* () {
            for (;;) {
              const moved = yield* hostExecutions.inventoryChanged();
              const row = yield* hostCommands.command(queued.execution);
              const phase = row?.state.phase ?? 'absent';
              yield* Queue.offer(seen, phase);
              if (phase === 'ended') return phase;
              yield* moved;
            }
          }),
        );
        expect(yield* Queue.take(seen)).toBe('queued');
        const stopping = yield* Effect.forkChild(stops.stop(claim, keyOf('op-wake-stop'), queued.execution, 'explicit-stop', 'signal'));
        expect(yield* Queue.take(seen)).toBe('queued');
        yield* Deferred.succeed(held, undefined);
        host.faults.childless = undefined;
        expect(yield* Fiber.join(reader)).toBe('ended');
        yield* Fiber.join(stopping);
      }),
    );

    const firstPage = yield* pageOf(host, queryOf({ limit: 1 }));
    if (firstPage.after === undefined) return yield* Effect.die(new Error('the fixture has no second inventory row'));
    expect(yield* hostCommands.inventory(queryOf({ limit: 1, after: firstPage.after, owner: 'somebody-else' }))).toMatchObject({
      _tag: 'Refused',
      reason: 'filters-changed',
    });
    const whole = yield* pageOf(host);
    const seen: ExecutionId[] = [];
    let after: CommandWatermark | undefined;
    do {
      const answered = yield* pageOf(host, queryOf({ limit: 1, after }));
      for (const entry of answered.commands) seen.push(entry.state.ref.execution);
      after = answered.after;
    } while (after !== undefined);
    expect(seen).toEqual(whole.commands.map((entry) => entry.state.ref.execution));
    expect(new Set(seen).size).toBe(seen.length);

    const ref = yield* accept(host, 'op-batch', 'printf z');
    const absent: ExecutionRef = { ...ref, execution: ExecutionId.make('execution-nobody-holds') };
    const held = yield* hostCommands.commandsAt([ref, absent]);
    host.faults.unreadable = true;
    const unreadable = yield* hostCommands.commandsAt([ref]);
    host.faults.unreadable = false;
    expect(held.commands).toHaveLength(1);
    expect(held.unmeasured).toEqual([]);
    expect(unreadable.commands).toHaveLength(0);
    expect(unreadable.unmeasured.length).toBeGreaterThan(0);
    yield* host.close;
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('output volume moves the inventory no more than one byte does, through the command leaving the live map', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const measure = Effect.fnUntraced(function* (line: string) {
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'inventory-bytes-' });
      const host = yield* openHost({ directory, registration: registrationOf(directory), key: 'take-bytes', expected: 0 });
      const before = yield* host.hostExecutions.inventoryRevision();
      const ref = yield* accept(host, 'op-bytes', line);
      yield* until(
        host.hostExecutions.changes(before, 12),
        (read) => read._tag === 'Changed' && read.left.some((left) => left.execution === ref.execution),
      );
      const moved = (yield* host.hostExecutions.inventoryRevision()) - before;
      yield* host.close;
      return moved;
    });
    const small = yield* measure('printf x');
    const large = yield* measure('head -c 65536 /dev/zero | tr "\\0" "y"');
    expect(large).toBe(small);
    expect(small).toBeGreaterThan(0);
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('a replacement generation keeps childless history without reopening the previous start and stop keys', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'inventory-restart-' });
    const registration = registrationOf(directory);
    const first = yield* openHost({ directory, registration, key: 'take-restart-0', expected: 0 });
    const victim = yield* parked(
      first,
      Effect.fnUntraced(function* (gate) {
        const ref = yield* accept(first, 'op-restart-victim', 'echo never-runs');
        yield* Deferred.await(gate.entered);
        yield* first.stops.stop(first.claim, keyOf('op-restart-victim-stop'), ref.execution, 'explicit-stop', 'signal');
        return ref;
      }),
    );
    yield* first.close;
    const next = yield* openHost({ directory, registration, key: 'take-restart-1', expected: 1 });
    expect(rowOf((yield* pageOf(next)).commands, victim.execution)).toBeUndefined();
    const batch = yield* next.hostCommands.commandsAt([victim]);
    expect(batch.commands).toEqual([]);
    expect(batch.unmeasured.length).toBeGreaterThan(0);
    expect(yield* next.requests.operation(keyOf('op-restart-victim-stop'))).toMatchObject({
      _tag: 'Refused',
      refusal: { _tag: 'IncarnationMismatch' },
    });
    expect((yield* next.hostExecutions.start(next.claim, keyOf('op-restart-victim'), commandOf('echo never-runs')))._tag).toBe('Refused');
    yield* next.close;
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('the native-join wake publishes a phases:running page only after that phase is readable', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'inventory-running-' });
    const host = yield* openHost({ directory, registration: registrationOf(directory), key: 'take-running-window', expected: 0 });
    const held = yield* Deferred.make<void>();
    host.faults.running = held;
    yield* Effect.addFinalizer(() => Deferred.succeed(held, undefined));
    const before = yield* host.hostExecutions.inventoryRevision();
    const started = yield* Effect.forkChild(accept(host, 'op-running-window', 'sleep 30'));
    const standing = yield* until(pageOf(host), (page) => page.commands.some((entry) => entry.state.phase === 'running'));
    const row = standing.commands.find((entry) => entry.state.phase === 'running');
    if (row === undefined) return yield* Effect.die(new Error('the running command disappeared'));
    const parked = yield* host.hostExecutions.inventoryRevision();
    const waiting = yield* host.hostExecutions.inventoryChanged();
    yield* Deferred.succeed(held, undefined);
    host.faults.running = undefined;
    yield* waiting;
    const page = yield* pageOf(host, queryOf({ phases: ['running'] }));
    yield* Fiber.join(started);
    yield* host.stops.stop(host.claim, keyOf('op-running-window-stop'), row.state.ref.execution, 'explicit-stop', 'signal');
    expect(parked).toBe(before + 1);
    expect(rowOf(page.commands, row.state.ref.execution)?.state.phase).toBe('running');
    yield* host.close;
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('the first byte of output moves the inventory, and its reading answers whether the command has printed', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'inventory-printed-' });
    const host = yield* openHost({ directory, registration: registrationOf(directory), key: 'take-printed', expected: 0 });
    const gate = `${directory}/gate`;
    yield* Effect.sync(() => Bun.spawnSync(['mkfifo', gate]));
    const held = yield* Deferred.make<void>();
    host.faults.running = held;
    yield* Effect.addFinalizer(() => Deferred.succeed(held, undefined));
    const started = yield* Effect.forkChild(accept(host, 'op-printed', `read -r _ < '${gate}'; printf x; exec sleep 30`));
    const silent = yield* until(pageOf(host), (page) => page.commands.some((entry) => entry.state.phase === 'running'));
    const launched = yield* host.hostExecutions.inventoryChanged();
    yield* Deferred.succeed(held, undefined);
    host.faults.running = undefined;
    yield* launched;
    const ref = yield* Fiber.join(started);
    const revision = yield* host.hostExecutions.inventoryRevision();
    const moved = yield* host.hostExecutions.inventoryChanged();
    yield* files.writeFileString(gate, '');
    yield* moved;
    const spoken = yield* host.hostCommands.commandsAt([ref]);
    const changes = yield* host.hostExecutions.changes(revision, 12);
    yield* host.stops.stop(host.claim, keyOf('op-printed-stop'), ref.execution, 'explicit-stop', 'signal');
    expect(rowOf(silent.commands, ref.execution)?.printed).toBe(false);
    expect(rowOf(spoken.commands, ref.execution)?.printed).toBe(true);
    expect(changes._tag === 'Changed' ? changes.executions.map((summary) => [summary.state.ref.execution, summary.printed]) : []).toEqual([
      [ref.execution, true],
    ]);
    yield* host.close;
  }).pipe(Effect.provide(BunServices.layer)),
);
