import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Duration, Effect, Fiber, FileSystem, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { CeilingExemption, CommandAdmission, CommandLimits, DeadlineChange } from '@runlith/executions/protocol/command';
import { STOP_LADDER } from '@runlith/executions/protocol/call';
import { Principal } from '@runlith/executions/protocol/custody';
import { InstallationId, type ExecutionId, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { Registration } from '@runlith/executions/protocol/registration';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { HostCommands } from './registry/inventory';
import { ExecutionStop } from './registry/stops';
import type { HostClaim } from './registry/state';
import { ExecutionStore } from './store/ExecutionStore';
import { StoreLost } from './store/errors';
import { connectionOf, keyOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { Processes } from './ProcessReader';

const agent = Principal.make('agent-1');
const admissionOf = (over: Partial<CommandLimits> = {}): CommandAdmission => ({
  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
  limits: { executionMs: 60_000, executionCeilingMs: 300_000, ...over },
  policyIdentity: 'policy-1',
});
type CommandInput = { readonly witness: string; readonly wait?: boolean; readonly admission?: CommandAdmission };
const commandOf = ({ witness, wait = true, admission = admissionOf() }: CommandInput): LaunchRequest => ({
  command: {
    program: '/bin/sh',
    args: ['-c', `printf run >> "$1"; ${wait ? 'exec sleep 30' : ':'}`, 'sh', witness],
    environment: [{ name: 'PATH', value: '/usr/bin:/bin' }],
  },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: agent,
  origin: agent,
  admission,
});
type Gate = { readonly held: Deferred.Deferred<void>; readonly entered: Deferred.Deferred<void> };
const gateOf = (): Gate => ({ held: Deferred.makeUnsafe<void>(), entered: Deferred.makeUnsafe<void>() });
type Faults = {
  records: Gate | undefined;
  revision: Gate | undefined;
  landed: Gate | undefined;
  custody: Gate | undefined;
  resolve: Gate | undefined;
  revisionRefused: boolean;
  resolveRefused: boolean;
  endingRefused: boolean;
};
type Host = {
  readonly hostExecutions: Executions['Service'];
  readonly requests: ExecutionRequest['Service'];
  readonly hostCommands: HostCommands['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly store: ExecutionStore['Service'];
  readonly claim: HostClaim;
  readonly directory: string;
  readonly registration: Registration;
  readonly faults: Faults;
};
class DeadlineHost extends Context.Service<DeadlineHost, Host>()('test/CommandDeadline/Host') {}
const pass = (gate: Gate | undefined) =>
  gate === undefined ? Effect.void : Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.held));
const fixture = Layer.effect(
  DeadlineHost,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-deadline-' });
    const registration = registrationOf(directory);
    const faults: Faults = {
      records: undefined,
      revision: undefined,
      landed: undefined,
      custody: undefined,
      resolve: undefined,
      revisionRefused: false,
      resolveRefused: false,
      endingRefused: false,
    };
    const capacity = ExecutionCapacity.layer(runtimeProfile({ executions: 16, transports: ['pipes'] }));
    const state = hostState(`${directory}/executions.sqlite`, registration, yield* sharedPool).pipe(Layer.provideMerge(capacity));
    const store = Layer.effect(
      ExecutionStore,
      Effect.gen(function* () {
        const real = yield* ExecutionStore;
        return ExecutionStore.of({
          ...real,
          recordRevision: Effect.fnUntraced(function* (accepted) {
            yield* pass(faults.revision);
            if (faults.revisionRefused)
              return yield* new StoreLost({ reason: 'the case armed a writer that takes no revision', cleanup: 'unknown' });
            const result = yield* real.recordRevision(accepted);
            yield* pass(faults.landed);
            return result;
          }),
          resolveRevision: Effect.fnUntraced(function* (operation, outcome) {
            yield* pass(faults.resolve);
            if (faults.resolveRefused)
              return yield* new StoreLost({ reason: 'the case armed a writer that takes no outcome', cleanup: 'unknown' });
            return yield* real.resolveRevision(operation, outcome);
          }),
          endRevisionsOf: (execution) =>
            Effect.suspend(() =>
              faults.endingRefused
                ? Effect.fail(new StoreLost({ reason: 'the case armed a writer that settles no ending', cleanup: 'unknown' }))
                : real.endRevisionsOf(execution),
            ),
          custodyOf: Effect.fnUntraced(function* (execution) {
            yield* pass(faults.custody);
            return yield* real.custodyOf(execution);
          }),
        });
      }),
    ).pipe(Layer.provideMerge(state));
    const heldFiles = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const real = yield* FileSystem.FileSystem;
        return FileSystem.FileSystem.of({
          ...real,
          makeDirectory: (path, options) =>
            Effect.suspend(() =>
              Effect.andThen(
                path.startsWith(`${directory}/records`) ? pass(faults.records) : Effect.void,
                real.makeDirectory(path, options),
              ),
            ),
        });
      }),
    ).pipe(Layer.provide(BunFileSystem.layer));
    const owners = ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(store),
      Layer.provide(Layer.effectContext(TestClock.withLive(Effect.map(Layer.build(testHolder(directory)), Context.omit(Processes))))),
      Layer.provideMerge(heldFiles),
      Layer.provide(hostSpawner),
    );
    const context = yield* Layer.build(owners);
    return yield* Effect.gen(function* () {
      const custodian = yield* Custodian;
      const connection = connectionOf('connection-host');
      const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
      return {
        hostExecutions: yield* Executions,
        requests: yield* ExecutionRequest,
        hostCommands: yield* HostCommands,
        stops: yield* ExecutionStop,
        store: yield* ExecutionStore,
        claim: { connection, epoch: taken.standing.epoch, role: 'custodian' },
        directory,
        registration,
        faults,
      } satisfies Host;
    }).pipe(Effect.provide(context));
  }),
).pipe(Layer.provideMerge(BunServices.layer));
const reset = Effect.fnUntraced(function* (faults: Faults) {
  for (const gate of [faults.records, faults.revision, faults.landed, faults.custody, faults.resolve])
    if (gate !== undefined) yield* Deferred.succeed(gate.held, undefined);
  faults.records = undefined;
  faults.revision = undefined;
  faults.landed = undefined;
  faults.custody = undefined;
  faults.resolve = undefined;
  faults.revisionRefused = false;
  faults.resolveRefused = false;
  faults.endingRefused = false;
});
const withHost = <A, E, R>(body: (host: Host) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(DeadlineHost, body, (host) => reset(host.faults));
const witnessed = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  return yield* files.readFileString(path).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')));
});
const until = Effect.fnUntraced(function* <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) {
  let value = yield* read;
  while (!done(value)) {
    yield* Effect.yieldNow;
    value = yield* read;
  }
  return value;
});
const running = (path: string) => until(witnessed(path), (value) => value !== '');
const armed = (host: Host, execution: ExecutionId) =>
  until(host.hostCommands.command(execution), (row) => row?.deadline.armed !== undefined);
const stopped = Effect.fnUntraced(function* (host: Host, execution: ExecutionId) {
  const row = yield* until(host.hostCommands.command(execution), (row) => row?.state.phase === 'ended');
  yield* TestClock.adjust(STOP_LADDER.reapMs);
  return row;
});
const decided = (host: Host, key: HostRequestRef) => until(host.requests.callResult(key), (answer) => answer._tag !== 'Pending');
const accept = Effect.fnUntraced(function* (host: Host, key: HostRequestRef, input: CommandInput) {
  const answer = yield* host.hostExecutions.start(host.claim, key, commandOf(input));
  if (answer._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${answer._tag}`));
  const execution = answer.execution.execution;
  yield* Effect.addFinalizer(() =>
    Effect.orDie(
      Effect.gen(function* () {
        const row = yield* host.hostCommands.command(execution);
        if (row?.state.phase !== 'ended') yield* end(host, `cleanup-${key.operation}`, execution);
      }),
    ),
  );
  return execution;
});
const revise = (
  host: Host,
  operation: HostRequestRef,
  execution: ExecutionId,
  expected: number,
  change: DeadlineChange,
  exception?: CeilingExemption,
) =>
  host.hostCommands.revise(host.claim, {
    operation,
    execution: { installation: host.registration.installation, execution, incarnation: 0 },
    expected,
    change,
    actor: 'agent-1',
    cause: 'the case asked for it',
    exception,
  });
const end = Effect.fnUntraced(function* (host: Host, key: string, execution: ExecutionId) {
  const stopping = yield* Effect.forkChild(host.stops.stop(host.claim, keyOf(key), execution, 'explicit-stop', 'destroy'));
  return yield* Effect.raceFirst(Fiber.join(stopping), Effect.andThen(stopped(host, execution), Fiber.join(stopping)));
});

layer(fixture)("a command's deadline", (it) => {
  it.effect('takes a total while queued and refuses a remaining duration before acquisition', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const execution = yield* accept(open, keyOf('deadline-queued'), { witness: `${open.directory}/queued`, wait: false });
        yield* Deferred.await(gate.entered);
        expect(yield* revise(open, keyOf('revise-queued-total'), execution, 0, { _tag: 'Total', executionMs: 30_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 30_000, revision: 1 },
        });
        expect(
          yield* revise(open, keyOf('revise-queued-remaining'), execution, 1, { _tag: 'Remaining', remainingMs: 10_000 }),
        ).toMatchObject({ _tag: 'Refused', reason: 'not-armed' });
        const snapshot = yield* open.hostCommands.command(execution);
        expect(snapshot?.deadline).toMatchObject({ revision: 1, executionMs: 30_000 });
        expect(snapshot?.deadline.armed).toBeUndefined();
      }),
    ),
  );

  it.effect('refuses a total beyond its admitted ceiling and records an explicit exception separately from the request', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/ceiling`;
        const execution = yield* accept(open, keyOf('deadline-ceiling'), { witness });
        yield* running(witness);
        yield* armed(open, execution);
        expect(yield* revise(open, keyOf('revise-above'), execution, 0, { _tag: 'Total', executionMs: 400_000 })).toMatchObject({
          _tag: 'Refused',
          reason: 'above-ceiling',
        });
        expect(
          yield* revise(
            open,
            keyOf('revise-exception'),
            execution,
            0,
            { _tag: 'Total', executionMs: 400_000 },
            { ceilingMs: 500_000, actor: 'operator-1', cause: 'one longer command' },
          ),
        ).toMatchObject({ _tag: 'Revised', deadline: { executionMs: 400_000, ceilingMs: 500_000 } });
        expect((yield* open.hostCommands.command(execution))?.deadline.armed).toBe('native-acquired');
        expect(yield* open.store.revisionAt(keyOf('revise-exception'))).toMatchObject({
          actor: 'agent-1',
          exception: { actor: 'operator-1', cause: 'one longer command' },
        });
        yield* end(open, 'stop-ceiling', execution);
      }),
    ),
  );

  it.effect('ends the child when its deadline falls between arming and publication in the live map', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.custody = gate;
        const witness = `${open.directory}/prepublish`;
        const key = keyOf('deadline-prepublish');
        const execution = yield* accept(open, key, { witness, admission: admissionOf({ executionMs: 5_000 }) });
        yield* running(witness);
        yield* Deferred.await(gate.entered);
        yield* TestClock.adjust(Duration.seconds(6));
        yield* Deferred.succeed(gate.held, undefined);
        yield* stopped(open, execution);
        expect(yield* decided(open, key)).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'timeout' } },
        });
        const ending = yield* until(open.stops.ending(execution), (value) => value !== undefined);
        expect(ending).toMatchObject({ cleanup: 'complete', nativeExit: { _tag: 'Signal', signal: 'SIGINT' } });
      }),
    ),
  );

  it.effect('converts a remaining duration once against elapsed time and refuses a stale revision', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/remaining`;
        const execution = yield* accept(open, keyOf('deadline-remaining'), { witness });
        yield* running(witness);
        yield* armed(open, execution);
        yield* TestClock.adjust(Duration.seconds(10));
        expect(yield* revise(open, keyOf('revise-remaining'), execution, 0, { _tag: 'Remaining', remainingMs: 5_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 15_000 },
        });
        expect(yield* revise(open, keyOf('revise-stale'), execution, 0, { _tag: 'Total', executionMs: 45_000 })).toMatchObject({
          _tag: 'Stale',
          deadline: { revision: 1, executionMs: 15_000 },
        });
        expect((yield* open.hostCommands.command(execution))?.deadline.revision).toBe(1);
        yield* end(open, 'stop-remaining', execution);
      }),
    ),
  );

  it.effect('moves the inventory only for an accepted revision', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/inventory`;
        const execution = yield* accept(open, keyOf('deadline-inventory'), { witness });
        yield* running(witness);
        yield* armed(open, execution);
        const before = yield* open.hostExecutions.inventoryRevision();
        expect((yield* revise(open, keyOf('revise-inventory'), execution, 0, { _tag: 'Total', executionMs: 45_000 }))._tag).toBe('Revised');
        const after = yield* open.hostExecutions.inventoryRevision();
        expect((yield* revise(open, keyOf('revise-inventory-stale'), execution, 0, { _tag: 'Total', executionMs: 50_000 }))._tag).toBe(
          'Stale',
        );
        expect(after - before).toBeGreaterThanOrEqual(1);
        expect(yield* open.hostExecutions.inventoryRevision()).toBe(after);
        yield* end(open, 'stop-inventory', execution);
      }),
    ),
  );

  it.effect('ends immediately under the revision that lowers the deadline below elapsed time, and cannot revive that decision', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/lowered`;
        const key = keyOf('deadline-lowered');
        const execution = yield* accept(open, key, { witness });
        yield* running(witness);
        yield* armed(open, execution);
        yield* TestClock.adjust(Duration.seconds(20));
        expect((yield* revise(open, keyOf('revise-lowered'), execution, 0, { _tag: 'Total', executionMs: 1_000 }))._tag).toBe('Revised');
        const answer = yield* decided(open, key);
        expect(answer).toMatchObject({ _tag: 'Settled', result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'timeout' } } });
        if (answer._tag !== 'Settled' || answer.result._tag !== 'Decided' || answer.result.decision._tag !== 'Cancelled')
          return yield* Effect.die(new Error('no deadline decision'));
        expect(answer.result.decision.trigger).toContain('revision 1');
        expect(yield* revise(open, keyOf('revise-late'), execution, 1, { _tag: 'Total', executionMs: 200_000 })).toMatchObject({
          _tag: 'Ended',
          decision: { _tag: 'Cancelled' },
        });
      }),
    ),
  );

  it.effect('never extends a deadline whose instant has already been reached', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/reached`;
        const key = keyOf('deadline-reached');
        const execution = yield* accept(open, key, { witness, admission: admissionOf({ executionMs: 5_000 }) });
        yield* running(witness);
        yield* armed(open, execution);
        yield* TestClock.adjust(Duration.seconds(5));
        expect((yield* revise(open, keyOf('revise-reached'), execution, 0, { _tag: 'Total', executionMs: 300_000 }))._tag).toBe('Ended');
        expect(yield* decided(open, key)).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'timeout' } },
        });
      }),
    ),
  );

  it.effect('applies nothing under a revision the writer refuses and preserves the caller stop cause', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.revision = gate;
        open.faults.revisionRefused = true;
        const witness = `${open.directory}/refused`;
        const key = keyOf('deadline-refused');
        const execution = yield* accept(open, key, { witness });
        yield* running(witness);
        yield* armed(open, execution);
        yield* TestClock.adjust(Duration.seconds(10));
        const asking = yield* Effect.forkChild(
          Effect.flip(revise(open, keyOf('revise-refused'), execution, 0, { _tag: 'Total', executionMs: 1_000 })),
        );
        yield* Deferred.await(gate.entered);
        const stopping = yield* Effect.forkChild(Effect.result(end(open, 'stop-refused', execution)));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate.held, undefined);
        expect((yield* Fiber.join(asking))._tag).toBe('ExecutionUnrecorded');
        yield* Fiber.join(stopping);
        expect(yield* decided(open, key)).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'explicit-stop' } },
        });
      }),
    ),
  );

  it.effect('spends the remaining allowance while its revision record is in flight', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.revision = gate;
        const witness = `${open.directory}/latency`;
        const key = keyOf('deadline-latency');
        const execution = yield* accept(open, key, { witness });
        yield* running(witness);
        yield* armed(open, execution);
        const asking = yield* Effect.forkChild(
          revise(open, keyOf('revise-latency'), execution, 0, { _tag: 'Remaining', remainingMs: 5_000 }),
        );
        yield* Deferred.await(gate.entered);
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Deferred.succeed(gate.held, undefined);
        expect((yield* Fiber.join(asking))._tag).toBe('Revised');
        expect(yield* decided(open, key)).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'timeout' } },
        });
      }),
    ),
  );

  it.effect('publishes a committed revision even if its caller is interrupted before the answer', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const setup = gateOf();
        const landed = gateOf();
        open.faults.records = setup;
        open.faults.landed = landed;
        const witness = `${open.directory}/interrupted`;
        const execution = yield* accept(open, keyOf('deadline-interrupted'), { witness });
        yield* Deferred.await(setup.entered);
        const asking = yield* Effect.forkChild(
          revise(open, keyOf('revise-interrupted'), execution, 0, { _tag: 'Total', executionMs: 30_000 }),
        );
        yield* Deferred.await(landed.entered);
        asking.interruptUnsafe();
        yield* Effect.yieldNow;
        yield* Deferred.succeed(landed.held, undefined);
        expect((yield* Fiber.await(asking))._tag).toBe('Failure');
        yield* Deferred.succeed(setup.held, undefined);
        yield* running(witness);
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ executionMs: 30_000, revision: 1 });
        expect(yield* revise(open, keyOf('revise-interrupted'), execution, 0, { _tag: 'Total', executionMs: 30_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 30_000 },
        });
        yield* end(open, 'stop-interrupted', execution);
      }),
    ),
  );

  it.effect('keeps launch and revision acts in separate key namespaces', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/namespace`;
        const key = keyOf('deadline-namespace');
        const execution = yield* accept(open, key, { witness });
        yield* running(witness);
        expect(yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 30_000 })).toMatchObject({
          _tag: 'Refused',
          reason: 'conflict',
        });
        expect((yield* open.requests.operation(key))._tag).toBe('Accepted');
        const revision = keyOf('revise-namespace');
        expect((yield* revise(open, revision, execution, 0, { _tag: 'Total', executionMs: 90_000 }))._tag).toBe('Revised');
        const second = `${open.directory}/namespace-second`;
        expect((yield* open.hostExecutions.start(open.claim, revision, commandOf({ witness: second, wait: false })))._tag).toBe('Refused');
        expect(yield* witnessed(second)).toBe('');
        expect(yield* open.requests.operation(revision)).toMatchObject({ _tag: 'Accepted', execution: { execution } });
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ executionMs: 90_000, revision: 1 });
        yield* end(open, 'stop-namespace', execution);
      }),
    ),
  );

  it.effect('answers an ending and replays it if work is given up while a revision is in flight', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const setup = gateOf();
        const writing = gateOf();
        open.faults.records = setup;
        open.faults.revision = writing;
        const witness = `${open.directory}/given-up`;
        const key = keyOf('deadline-given-up');
        const execution = yield* accept(open, key, { witness, wait: false });
        yield* Deferred.await(setup.entered);
        const asking = yield* Effect.forkChild(
          revise(open, keyOf('revise-given-up'), execution, 0, { _tag: 'Total', executionMs: 30_000 }),
        );
        yield* Deferred.await(writing.entered);
        yield* open.hostExecutions.cancelStart(open.claim, key, 'explicit-stop', 'test');
        yield* Deferred.succeed(writing.held, undefined);
        expect((yield* Fiber.join(asking))._tag).toBe('Ended');
        yield* Deferred.succeed(setup.held, undefined);
        expect((yield* open.hostCommands.command(execution))?.state.phase).toBe('ended');
        expect((yield* revise(open, keyOf('revise-given-up'), execution, 0, { _tag: 'Total', executionMs: 30_000 }))._tag).toBe('Ended');
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('records the ending as the revision disposition when work is given up while that disposition is in flight', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const setup = gateOf();
        const writing = gateOf();
        open.faults.records = setup;
        open.faults.resolve = writing;
        const witness = `${open.directory}/late-ending`;
        const key = keyOf('deadline-late-ending');
        const execution = yield* accept(open, key, { witness, wait: false });
        yield* Deferred.await(setup.entered);
        const revision = keyOf('revise-late-ending');
        const asking = yield* Effect.forkChild(revise(open, revision, execution, 0, { _tag: 'Total', executionMs: 30_000 }));
        yield* Deferred.await(writing.entered);
        yield* open.hostExecutions.cancelStart(open.claim, key, 'explicit-stop', 'test');
        yield* Deferred.succeed(writing.held, undefined);
        expect((yield* Fiber.join(asking))._tag).toBe('Ended');
        yield* Deferred.succeed(setup.held, undefined);
        expect((yield* open.store.revisionAt(revision))?.outcome).toBe('ended');
        expect((yield* revise(open, revision, execution, 0, { _tag: 'Total', executionMs: 30_000 }))._tag).toBe('Ended');
        expect((yield* open.hostCommands.command(execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('reports an unrecorded stop without leaving the queued work runnable', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const setup = gateOf();
        open.faults.records = setup;
        open.faults.endingRefused = true;
        const witness = `${open.directory}/unsettled-ending`;
        const execution = yield* accept(open, keyOf('deadline-unsettled-ending'), { witness, wait: false });
        yield* Deferred.await(setup.entered);
        expect((yield* Effect.flip(end(open, 'stop-unsettled', execution)))._tag).toBe('ExecutionUnrecorded');
        open.faults.endingRefused = false;
        yield* Deferred.succeed(setup.held, undefined);
        expect((yield* open.hostCommands.command(execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('governs nothing if the revision disposition cannot be recorded, and readback preserves uncertainty', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        open.faults.resolveRefused = true;
        const witness = `${open.directory}/unresolved`;
        const execution = yield* accept(open, keyOf('deadline-unresolved'), { witness });
        yield* running(witness);
        const key = keyOf('revise-unresolved');
        expect((yield* Effect.flip(revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 })))._tag).toBe(
          'ExecutionUnrecorded',
        );
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ revision: 0, executionMs: 60_000 });
        open.faults.resolveRefused = false;
        expect((yield* Effect.flip(revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 })))._tag).toBe(
          'ExecutionUnreadable',
        );
        expect((yield* open.requests.operation(key))._tag).toBe('Uncertain');
        yield* end(open, 'stop-unresolved', execution);
      }),
    ),
  );

  it.effect('a repeated revision key keeps its original answer across later revisions and an ending, and rejects changed input', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/key`;
        const execution = yield* accept(open, keyOf('deadline-key'), { witness });
        yield* running(witness);
        const key = keyOf('revise-key');
        const first = yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 });
        expect(first).toMatchObject({ _tag: 'Revised', deadline: { executionMs: 90_000, revision: 1 } });
        expect(yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 90_000, revision: 1 },
        });
        expect(yield* revise(open, keyOf('revise-key-second'), execution, 1, { _tag: 'Total', executionMs: 120_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { revision: 2 },
        });
        expect(yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 90_000, revision: 1 },
        });
        expect(yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 100_000 })).toMatchObject({
          _tag: 'Refused',
          reason: 'conflict',
        });
        expect((yield* open.requests.operation(key))._tag).toBe('Accepted');
        yield* end(open, 'stop-key', execution);
        yield* stopped(open, execution);
        expect(yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 90_000, revision: 1 },
        });
      }),
    ),
  );

  it.effect('refuses foreign installation and retired generation references without moving a deadline', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/identity`;
        const execution = yield* accept(open, keyOf('deadline-identity'), { witness });
        yield* running(witness);
        for (const ref of [
          { installation: InstallationId.make('another-installation'), execution, incarnation: 0 },
          { installation: open.registration.installation, execution, incarnation: 7 },
        ]) {
          const answer = yield* open.hostCommands.revise(open.claim, {
            operation: keyOf(`revise-identity-${ref.incarnation}-${ref.installation}`),
            execution: ref,
            expected: 0,
            change: { _tag: 'Total', executionMs: 90_000 },
            actor: 'agent-1',
            cause: 'identity contract',
          });
          expect(answer).toMatchObject({ _tag: 'Refused', reason: 'identity' });
        }
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ revision: 0, executionMs: 60_000 });
        yield* end(open, 'stop-identity', execution);
      }),
    ),
  );

  it.effect('refuses cancellation under a revision key rather than calling it uncertain', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/cancel-key`;
        const execution = yield* accept(open, keyOf('deadline-cancel-key'), { witness });
        yield* running(witness);
        const key = keyOf('revise-then-cancel');
        expect((yield* revise(open, key, execution, 0, { _tag: 'Total', executionMs: 90_000 }))._tag).toBe('Revised');
        expect(yield* open.hostExecutions.cancelStart(open.claim, key, 'explicit-stop', 'the case asked for it')).toMatchObject({
          _tag: 'Refused',
          refusal: { _tag: 'OperationConflict' },
        });
        yield* end(open, 'stop-cancel-key', execution);
      }),
    ),
  );

  const unbounded = (origin?: CommandLimits['origin']): CommandAdmission => ({ ...admissionOf(), limits: { origin } });
  it.effect('an unbounded command runs beyond the bounded cases and reads no invented time allowance', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/none`;
        const key = keyOf('deadline-none');
        const execution = yield* accept(open, key, { witness, admission: unbounded() });
        yield* until(open.hostCommands.command(execution), (row) => row?.state.phase === 'running');
        yield* TestClock.adjust(Duration.millis(900_001));
        const snapshot = yield* open.hostCommands.command(execution);
        expect(snapshot?.state.phase).toBe('running');
        expect((yield* open.requests.callResult(key))._tag).toBe('Pending');
        expect(snapshot?.deadline.executionMs).toBeUndefined();
        expect(snapshot?.deadline.ceilingMs).toBeUndefined();
        expect(snapshot?.deadline.expiresAt).toBeUndefined();
        expect(snapshot?.deadline.origin).toBe('caller');
        expect(snapshot?.deadline.elapsedMs).toBeGreaterThanOrEqual(900_001);
        yield* end(open, 'stop-none', execution);
      }),
    ),
  );

  it.effect('adds a deadline to unbounded work and ends at the remaining duration it names', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/none-revised`;
        const key = keyOf('deadline-none-revised');
        const execution = yield* accept(open, key, { witness, admission: unbounded() });
        yield* running(witness);
        yield* until(open.hostCommands.command(execution), (row) => row?.deadline.elapsedMs !== undefined);
        yield* TestClock.adjust(Duration.seconds(10));
        expect(yield* revise(open, keyOf('revise-none'), execution, 0, { _tag: 'Remaining', remainingMs: 5_000 })).toMatchObject({
          _tag: 'Revised',
          deadline: { executionMs: 15_000, origin: 'caller', armed: 'native-acquired' },
        });
        expect((yield* open.hostCommands.command(execution))?.deadline.ceilingMs).toBeUndefined();
        yield* TestClock.adjust(Duration.seconds(6));
        expect(yield* decided(open, key)).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'timeout' } },
        });
        yield* stopped(open, execution);
      }),
    ),
  );

  it.effect('keeps an admitted default origin until a revision makes the allowance the caller’s', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/origin`;
        const execution = yield* accept(open, keyOf('deadline-origin'), {
          witness,
          admission: { ...admissionOf(), limits: { executionMs: 60_000, origin: 'default' } },
        });
        yield* running(witness);
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ origin: 'default', executionMs: 60_000 });
        expect((yield* revise(open, keyOf('revise-origin'), execution, 0, { _tag: 'Total', executionMs: 90_000 }))._tag).toBe('Revised');
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({ origin: 'caller', executionMs: 90_000 });
        yield* end(open, 'stop-origin', execution);
      }),
    ),
  );

  it.effect('a background handoff releases the foreground bound without changing its default origin or allowance', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/foreground`;
        const execution = yield* accept(open, keyOf('deadline-foreground'), {
          witness,
          admission: { ...admissionOf(), limits: { executionMs: 60_000, origin: 'default', foregroundMs: 600_000 } },
        });
        yield* running(witness);
        expect((yield* open.hostCommands.command(execution))?.deadline).toMatchObject({
          foregroundMs: 600_000,
          origin: 'default',
          executionMs: 60_000,
        });
        expect(
          (yield* open.hostCommands.revise(open.claim, {
            operation: keyOf('release-foreground'),
            execution: { installation: open.registration.installation, execution, incarnation: 0 },
            expected: 0,
            change: { _tag: 'Total', executionMs: 60_000 },
            actor: 'agent-1',
            cause: 'background handoff',
            wait: 'background',
          }))._tag,
        ).toBe('Revised');
        const released = (yield* open.hostCommands.command(execution))?.deadline;
        expect(released).toMatchObject({ origin: 'default', executionMs: 60_000, revision: 1 });
        expect(released?.foregroundMs).toBeUndefined();
        yield* end(open, 'stop-foreground', execution);
      }),
    ),
  );

  it.effect('refuses a queued revision beyond foreground, then permits it after a queued background handoff', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const witness = `${open.directory}/foreground-bound`;
        const execution = yield* accept(open, keyOf('deadline-foreground-bound'), {
          witness,
          admission: { ...admissionOf(), limits: { executionMs: 60_000, origin: 'default', foregroundMs: 600_000 } },
        });
        yield* Deferred.await(gate.entered);
        expect(yield* revise(open, keyOf('revise-bound-queued'), execution, 0, { _tag: 'Total', executionMs: 900_000 })).toMatchObject({
          _tag: 'Refused',
          reason: 'above-ceiling',
        });
        expect(
          (yield* open.hostCommands.revise(open.claim, {
            operation: keyOf('release-bound-queued'),
            execution: { installation: open.registration.installation, execution, incarnation: 0 },
            expected: 0,
            change: { _tag: 'Total', executionMs: 60_000 },
            actor: 'agent-1',
            cause: 'background handoff',
            wait: 'background',
          }))._tag,
        ).toBe('Revised');
        yield* Deferred.succeed(gate.held, undefined);
        yield* running(witness);
        const deadline = (yield* armed(open, execution))?.deadline;
        expect(deadline).toMatchObject({ origin: 'default', executionMs: 60_000, armed: 'native-acquired' });
        expect(deadline?.foregroundMs).toBeUndefined();
        expect((yield* revise(open, keyOf('revise-bound-armed'), execution, 1, { _tag: 'Total', executionMs: 900_000 }))._tag).toBe(
          'Revised',
        );
        yield* end(open, 'stop-foreground-bound', execution);
      }),
    ),
  );

  it.effect('refuses an armed revision beyond foreground and accepts the bound exactly', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/foreground-armed`;
        const execution = yield* accept(open, keyOf('deadline-foreground-armed'), {
          witness,
          admission: { ...admissionOf(), limits: { executionMs: 60_000, origin: 'caller', foregroundMs: 600_000 } },
        });
        yield* running(witness);
        yield* armed(open, execution);
        expect(yield* revise(open, keyOf('revise-foreground-armed'), execution, 0, { _tag: 'Total', executionMs: 600_001 })).toMatchObject({
          _tag: 'Refused',
          reason: 'above-ceiling',
        });
        expect((yield* revise(open, keyOf('revise-foreground-within'), execution, 0, { _tag: 'Total', executionMs: 600_000 }))._tag).toBe(
          'Revised',
        );
        yield* end(open, 'stop-foreground-armed', execution);
      }),
    ),
  );
});
