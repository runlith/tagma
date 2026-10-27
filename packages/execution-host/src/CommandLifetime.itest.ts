import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import type { CommandAdmission, CommandLimits } from '@runlith/executions/protocol/command';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
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
import { StoreLost, StoreUnreadable } from './store/errors';
import { connectionOf, keyOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { Processes } from './ProcessReader';

const agent = Principal.make('agent-1');
const admissionOf = (over: Partial<CommandLimits> = {}): CommandAdmission => ({
  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
  limits: { executionMs: 600_000, executionCeilingMs: 900_000, ...over },
  policyIdentity: 'policy-1',
});
type CommandInput = { readonly witness?: string; readonly script?: string; readonly wait?: boolean; readonly admission?: CommandAdmission };
const commandOf = ({ witness = '', script, wait = false, admission = admissionOf() }: CommandInput): LaunchRequest => ({
  command: {
    program: '/bin/sh',
    args: ['-c', script ?? `printf run >> "$1"; ${wait ? 'exec sleep 30' : ':'}`, 'sh', witness],
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
  reserve: Gate | undefined;
  custody: Gate | undefined;
  unreadable: boolean;
  unreadableEnding: boolean;
  unrecordable: boolean;
  uncustodied: boolean;
};
type Host = {
  readonly hostExecutions: Executions['Service'];
  readonly requests: ExecutionRequest['Service'];
  readonly hostCommands: HostCommands['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly store: ExecutionStore['Service'];
  readonly claim: HostClaim;
  readonly directory: string;
  readonly faults: Faults;
};
type Case = Host & { readonly keys: Set<string> };
class CommandHost extends Context.Service<CommandHost, Host>()('test/CommandLifetime/Host') {}
const pass = (gate: Gate | undefined) =>
  gate === undefined ? Effect.void : Effect.andThen(Deferred.succeed(gate.entered, undefined), Deferred.await(gate.held));
const fixture = Layer.effect(
  CommandHost,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-command-' });
    const faults: Faults = {
      records: undefined,
      reserve: undefined,
      custody: undefined,
      unreadable: false,
      unreadableEnding: false,
      unrecordable: false,
      uncustodied: false,
    };
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ executions: 12, transports: ['pipes'] }))),
    );
    const store = Layer.effect(
      ExecutionStore,
      Effect.gen(function* () {
        const real = yield* ExecutionStore;
        return ExecutionStore.of({
          ...real,
          reserve: Effect.fnUntraced(function* (request) {
            yield* pass(faults.reserve);
            return yield* real.reserve(request);
          }),
          executionOf: (execution) =>
            Effect.suspend(() =>
              faults.unreadable
                ? Effect.fail(new StoreUnreadable({ record: 'execution', key: execution, reason: 'the case armed an unreadable row' }))
                : real.executionOf(execution),
            ),
          finalOf: (execution) =>
            Effect.suspend(() =>
              faults.unreadableEnding
                ? Effect.fail(new StoreUnreadable({ record: 'final', key: execution, reason: 'the case armed an unreadable row' }))
                : real.finalOf(execution),
            ),
          recordStop: (intent) =>
            Effect.suspend(() =>
              faults.unrecordable
                ? Effect.fail(new StoreLost({ reason: 'the case armed a writer that takes nothing', cleanup: 'unknown' }))
                : real.recordStop(intent),
            ),
          custodyOf: Effect.fnUntraced(function* (execution) {
            yield* pass(faults.custody);
            if (faults.uncustodied)
              return yield* new StoreUnreadable({ record: 'custody', key: execution, reason: 'the case armed an unreadable custody' });
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
      Layer.provide(Layer.effectContext(Effect.map(Layer.build(testHolder(directory)), Context.omit(Processes)))),
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
        faults,
      } satisfies Host;
    }).pipe(Effect.provide(context));
  }),
).pipe(Layer.provideMerge(BunServices.layer));
const cleanup = Effect.fnUntraced(function* (open: Case) {
  for (const gate of [open.faults.records, open.faults.reserve, open.faults.custody])
    if (gate !== undefined) yield* Deferred.succeed(gate.held, undefined);
  open.faults.records = undefined;
  open.faults.reserve = undefined;
  open.faults.custody = undefined;
  open.faults.unreadable = false;
  open.faults.unreadableEnding = false;
  open.faults.unrecordable = false;
  open.faults.uncustodied = false;
  for (const key of open.keys) {
    const answer = yield* open.requests.operation(keyOf(key));
    const ref =
      answer._tag === 'Accepted'
        ? answer.execution
        : answer._tag === 'Uncertain' && 'execution' in answer.effect
          ? answer.effect.execution
          : undefined;
    if (ref === undefined) continue;
    const row = yield* open.hostCommands.command(ref.execution);
    if (row?.state.phase !== 'ended')
      yield* open.stops.stop(open.claim, keyOf(`cleanup-${key}`), ref.execution, 'explicit-stop', 'destroy');
  }
});
const withHost = <A, E, R>(body: (host: Case) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.map(CommandHost, (host): Case => ({ ...host, keys: new Set() })),
    body,
    (host) => Effect.orDie(cleanup(host)),
  );
const start = (open: Case, key: string, launch: LaunchRequest) =>
  Effect.andThen(
    Effect.sync(() => {
      open.keys.add(key);
    }),
    open.hostExecutions.start(open.claim, keyOf(key), launch),
  );
const accepted = Effect.fnUntraced(function* (open: Case, key: string, launch: LaunchRequest) {
  const answer = yield* start(open, key, launch);
  if (answer._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${answer._tag}`));
  return answer.execution.execution;
});
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
const running = (path: string) => until(witnessed(path), Boolean);
const settled = (open: Host, execution: ExecutionId) => until(open.hostCommands.command(execution), (row) => row?.state.phase === 'ended');
const measured = (open: Host, execution: ExecutionId) => until(open.stops.ending(execution), (receipt) => receipt !== undefined);
const arrived = Effect.fnUntraced(function* (open: Host, execution: ExecutionId, ready: (summary: ExecutionSummary) => boolean) {
  const summary = yield* until(open.hostExecutions.summary(execution), (value) => value !== undefined && ready(value));
  if (summary === undefined) return yield* Effect.die(new Error('the execution has no summary'));
  return summary;
});
const stop = (open: Host, key: string, execution: ExecutionId, how: 'destroy' | 'signal' = 'destroy') =>
  open.stops.stop(open.claim, keyOf(key), execution, 'explicit-stop', how);

layer(fixture, { excludeTestServices: true })('a bounded command', (it) => {
  it.effect('accepts before acquisition and runs one native intent despite repeated requests', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/once`;
        const launch = commandOf({ witness });
        const first = yield* start(open, 'command-once', launch);
        const second = yield* start(open, 'command-once', launch);
        expect(first).toMatchObject({ _tag: 'Accepted', state: { phase: 'queued', lifetime: 'command' } });
        if (first._tag !== 'Accepted') return yield* Effect.die(new Error(`start: ${first._tag}`));
        expect(second).toMatchObject({ _tag: 'Accepted', execution: first.execution });
        expect((yield* settled(open, first.execution.execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('starts both admitted commands without waiting for either command to end', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witnesses = [0, 1].map((index) => `${open.directory}/together-${index}`);
        const executions = yield* Effect.forEach(witnesses, (witness, index) =>
          accepted(open, `command-together-${index}`, commandOf({ witness, wait: true })),
        );
        for (const witness of witnesses) yield* running(witness);
        expect(yield* Effect.forEach(witnesses, witnessed)).toEqual(['run', 'run']);
        for (const execution of executions) expect(yield* open.stops.ending(execution)).toBeUndefined();
        for (const [index, execution] of executions.entries()) yield* stop(open, `stop-together-${index}`, execution);
      }),
    ),
  );

  it.effect('refuses a changed intent under a spent key and spawns no second child', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/conflict`;
        const execution = yield* accepted(open, 'command-conflict', commandOf({ witness }));
        expect(
          yield* start(open, 'command-conflict', commandOf({ witness, admission: admissionOf({ executionMs: 20_000 }) })),
        ).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'OperationConflict' } });
        yield* settled(open, execution);
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('recovers the accepted execution from its key without resubmitting work', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/recover`;
        const execution = yield* accepted(open, 'command-recover', commandOf({ witness }));
        expect(yield* open.requests.operation(keyOf('command-recover'))).toMatchObject({ _tag: 'Accepted', execution: { execution } });
        yield* settled(open, execution);
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('cancels parked setup without waiting for it, retaining the measured childless ending', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const witness = `${open.directory}/cancel`;
        const execution = yield* accepted(open, 'command-cancel', commandOf({ witness }));
        yield* Deferred.await(gate.entered);
        expect((yield* open.hostExecutions.cancelStart(open.claim, keyOf('command-cancel'), 'explicit-stop', 'test'))._tag).toBe('Joined');
        const row = yield* open.hostCommands.command(execution);
        expect(row?.state.phase).toBe('ended');
        expect(row?.state.nativeExit).toBeUndefined();
        expect(yield* open.stops.ending(execution)).toMatchObject({
          cleanup: 'complete',
          confirmed: [],
          unverifiable: [],
          unacquired: 'explicit-stop: test',
        });
        yield* Deferred.succeed(gate.held, undefined);
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('records a stop of accepted work under its asking key and reissues the same childless measurement', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const witness = `${open.directory}/stop`;
        const execution = yield* accepted(open, 'command-stopped', commandOf({ witness }));
        yield* Deferred.await(gate.entered);
        const receipt = yield* stop(open, 'stop-queued', execution, 'signal');
        expect(receipt).toMatchObject({ cause: 'explicit-stop', requested: 'signal', cleanup: 'complete', confirmed: [] });
        expect(receipt.nativeExit).toBeUndefined();
        expect(yield* open.requests.operation(keyOf('stop-queued'))).toMatchObject({ _tag: 'Accepted', execution: { execution } });
        expect(yield* stop(open, 'stop-queued', execution, 'signal')).toMatchObject({
          execution: { execution },
          cause: 'explicit-stop',
          cleanup: 'complete',
          steps: [],
        });
        yield* Deferred.succeed(gate.held, undefined);
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('a stop in the acquiring window reaches its child after publication and measures the requested signal', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.custody = gate;
        const witness = `${open.directory}/acquiring`;
        const execution = yield* accepted(open, 'command-acquiring', commandOf({ witness, wait: true }));
        yield* Deferred.await(gate.entered);
        yield* running(witness);
        expect(yield* stop(open, 'stop-acquiring', execution, 'signal')).toMatchObject({
          cause: 'explicit-stop',
          requested: 'signal',
          cleanup: 'pending',
          relation: 'unknown',
        });
        yield* Deferred.succeed(gate.held, undefined);
        yield* settled(open, execution);
        const ending = yield* measured(open, execution);
        expect(ending?.cleanup).toBe('complete');
        expect(ending?.confirmed.map((item) => item.exit)).toContainEqual({ _tag: 'Signal', signal: 'SIGINT' });
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('an orphaned acquisition retains the caller stop key and requested action', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.custody = gate;
        open.faults.uncustodied = true;
        const witness = `${open.directory}/acquiring-orphan`;
        const execution = yield* accepted(open, 'command-orphaned', commandOf({ witness, wait: true }));
        yield* Deferred.await(gate.entered);
        yield* running(witness);
        const trigger = 'the command owner cancelled during acquisition';
        yield* open.stops.stop(open.claim, keyOf('stop-orphaned'), execution, 'explicit-stop', 'signal', trigger);
        yield* Deferred.succeed(gate.held, undefined);
        expect((yield* settled(open, execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('run');
        expect(yield* open.store.stopIntentOf(keyOf('stop-orphaned'))).toMatchObject({
          execution: { execution },
          requested: 'signal',
          cause: 'explicit-stop',
        });
        expect(yield* open.requests.callResult(keyOf('command-orphaned'))).toMatchObject({
          _tag: 'Settled',
          result: { _tag: 'Decided', decision: { _tag: 'Cancelled', cause: 'explicit-stop', trigger } },
        });
      }),
    ),
  );

  it.effect('distinguishes stop intents it cannot record from endings it cannot read and recovers once the store answers', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const witness = `${open.directory}/refusing-store`;
        const execution = yield* accepted(open, 'command-refusing-store', commandOf({ witness }));
        yield* Deferred.await(gate.entered);
        open.faults.unrecordable = true;
        expect((yield* Effect.flip(stop(open, 'stop-unwritten', execution, 'signal')))._tag).toBe('ExecutionUnrecorded');
        open.faults.unrecordable = false;
        open.faults.unreadableEnding = true;
        expect((yield* Effect.flip(stop(open, 'stop-unread', execution, 'signal')))._tag).toBe('ExecutionUnreadable');
        expect((yield* Effect.flip(open.stops.ending(execution)))._tag).toBe('ExecutionUnreadable');
        open.faults.unreadableEnding = false;
        expect((yield* stop(open, 'stop-unread', execution, 'signal')).cleanup).toBe('complete');
        open.faults.unrecordable = true;
        expect((yield* Effect.flip(stop(open, 'stop-unjoined', execution, 'signal')))._tag).toBe('ExecutionUnrecorded');
        open.faults.unrecordable = false;
        yield* Deferred.succeed(gate.held, undefined);
        expect(yield* witnessed(witness)).toBe('');
      }),
    ),
  );

  it.effect('retains failed acquisition as a childless ending that names why it never ran', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const base = commandOf({ script: 'unreachable' });
        const execution = yield* accepted(open, 'command-unacquired', {
          ...base,
          command: { ...base.command, program: `${open.directory}/no-such-program` },
        });
        const row = yield* settled(open, execution);
        expect(row?.state.phase).toBe('ended');
        expect(row?.state.nativeExit).toBeUndefined();
        const receipt = yield* measured(open, execution);
        expect(receipt?.cleanup).toBe('complete');
        expect(receipt?.unacquired?.length).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect('reports an unreadable command separately from a command this host never held', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const execution = yield* accepted(open, 'command-unreadable', commandOf({ witness: `${open.directory}/unreadable` }));
        yield* settled(open, execution);
        expect((yield* open.hostCommands.command(execution))?.admission.origin.owner).toBe('agent-1');
        open.faults.unreadable = true;
        expect((yield* Effect.flip(open.hostCommands.command(execution)))._tag).toBe('ExecutionUnreadable');
        open.faults.unreadable = false;
        expect(yield* open.hostCommands.command(ExecutionId.make('no-such-execution'))).toBeUndefined();
      }),
    ),
  );

  it.effect('cancels running pipe work with Ctrl-C to the whole group and names that step on each ending', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/interrupt`;
        const execution = yield* accepted(open, 'command-interrupt', commandOf({ witness, script: 'printf run >> "$1"; sleep 30' }));
        yield* running(witness);
        yield* open.hostExecutions.cancelStart(open.claim, keyOf('command-interrupt'), 'explicit-stop', 'test');
        const receipt = yield* measured(open, execution);
        expect(receipt?.confirmed.map((ending) => [ending.relation, ending.exit, ending.step])).toEqual([
          ['leader', { _tag: 'Signal', signal: 'SIGINT' }, 'interrupt'],
          ['work', { _tag: 'Signal', signal: 'SIGINT' }, 'interrupt'],
        ]);
      }),
    ),
  );

  it.effect('owns an admission interrupted inside the durable handoff before any answer was delivered', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.reserve = gate;
        const witness = `${open.directory}/handoff`;
        const asking = yield* Effect.forkChild(Effect.scoped(start(open, 'command-handoff', commandOf({ witness }))));
        yield* Deferred.await(gate.entered);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(asking));
        yield* Deferred.succeed(gate.held, undefined);
        yield* Fiber.join(interrupting);
        const answer = yield* until(open.requests.operation(keyOf('command-handoff')), (value) => value._tag !== 'Unanswered');
        expect(answer._tag).toBe('Accepted');
        if (answer._tag !== 'Accepted' || answer.execution === undefined)
          return yield* Effect.die(new Error('the handoff has no accepted identity'));
        expect((yield* settled(open, answer.execution.execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('outlives a withdrawn caller without losing readable admission or deciding an ending for it', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const gate = gateOf();
        open.faults.records = gate;
        const witness = `${open.directory}/orphan`;
        const ready = yield* Deferred.make<ExecutionId>();
        const asking = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const execution = yield* accepted(open, 'command-orphan', commandOf({ witness }));
              yield* Deferred.succeed(ready, execution);
              yield* Effect.never;
            }),
          ),
        );
        const execution = yield* Deferred.await(ready);
        yield* Deferred.await(gate.entered);
        yield* Fiber.interrupt(asking);
        yield* Deferred.succeed(gate.held, undefined);
        expect((yield* open.hostCommands.command(execution))?.admission).toMatchObject({
          origin: { owner: 'agent-1' },
          limits: { executionMs: 600_000 },
        });
        expect((yield* settled(open, execution))?.state.phase).toBe('ended');
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );

  it.effect('moves its own stream reading at measured completion and reports the native exit', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const execution = yield* accepted(open, 'command-sources', commandOf({ script: 'printf hi' }));
        const summary = yield* arrived(open, execution, (held) => held.decision !== undefined);
        expect(summary.state.nativeExit).toEqual({ _tag: 'Code', code: 0 });
        expect(summary.decision?._tag).toBe('Completed');
        expect(summary.state.streams).toEqual({ stdout: 'eof', stderr: 'eof', pty: 'eof' });
      }),
    ),
  );

  it.effect('keeps a call undecided while a descendant holds its pipes, then decides at its deadline and follows the source endings', () =>
    withHost(
      Effect.fnUntraced(function* (open) {
        const witness = `${open.directory}/holder`;
        const execution = yield* accepted(
          open,
          'command-holder',
          commandOf({ witness, script: 'sleep 2 & printf run >> "$1"; exit 0', admission: admissionOf({ executionMs: 1_000 }) }),
        );
        const holding = yield* arrived(open, execution, (held) => held.state.nativeExit !== undefined);
        expect(holding.state.streams).toEqual({ stdout: 'open', stderr: 'open', pty: 'open' });
        expect(holding.decision).toBeUndefined();
        expect((yield* open.requests.callResult(keyOf('command-holder')))._tag).toBe('Pending');
        const decided = yield* arrived(open, execution, (held) => held.decision !== undefined);
        expect(decided.decision).toMatchObject({ _tag: 'Cancelled', cause: 'timeout' });
        const released = yield* arrived(
          open,
          execution,
          (held) => held.state.streams.stdout !== 'open' && held.state.streams.stderr !== 'open',
        );
        expect(released.state.streams).toEqual({ stdout: 'eof', stderr: 'eof', pty: 'eof' });
        expect(yield* witnessed(witness)).toBe('run');
      }),
    ),
  );
});
