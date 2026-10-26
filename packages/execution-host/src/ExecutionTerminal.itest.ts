import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Effect, FileSystem, Layer, Schedule } from 'effect';
import { STOP_LADDER } from '@runlith/executions/protocol/call';
import { byteOffset, offsetValue, sameGeometry, type TerminalGeometry } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { ExecutionId } from '@runlith/executions/protocol/execution';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { InputLanes, PaceControl } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostLifecycle } from './registry/shutdown';
import { HostByteRecords, TerminalScreen } from './registry/reads';
import type { HostClaim } from './registry/state';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { background } from './posix/testing/tempo';
import { runtimeProfile } from './runtimeFixture';
import { Processes, type ProcessReader } from './ProcessReader';
import { ProcessControl } from './ProcessControl';
import { ProcessTree } from './processTree';

const launch = (program: string, args: readonly string[]): LaunchRequest => ({
  command: {
    program,
    args,
    environment: [
      { name: 'PATH', value: '/usr/bin:/bin' },
      { name: 'TERM', value: 'xterm-256color' },
      { name: 'PS1', value: '' },
    ],
    cwd: '/tmp',
  },
  transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: principalOf('principal-operator'),
  origin: principalOf('principal-operator'),
  budget: {},
});
type TerminalWorld = {
  readonly hostExecutions: Executions['Service'];
  readonly lanes: InputLanes['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly byteRecords: HostByteRecords['Service'];
  readonly screens: TerminalScreen['Service'];
  readonly pacing: PaceControl['Service'];
  readonly bindings: Bindings['Service'];
  readonly claim: HostClaim;
  readonly processes: ProcessReader;
  readonly control: ProcessControl['Service'];
};
type TerminalCase<A, E, R> = { readonly body: (world: TerminalWorld) => Effect.Effect<A, E, R>; readonly executions?: number };
const withTerminalHost = Effect.fnUntraced(
  function* <A, E, R>({ body, executions = 1 }: TerminalCase<A, E, R>) {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'execution-terminal-' });
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ transports: ['pty'], rows: 40, columns: 120, executions }))),
    );
    const layer = ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(state),
      Layer.provideMerge(testHolder(directory)),
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const custodian = yield* Custodian;
        const lifecycle = yield* HostLifecycle;
        const connection = connectionOf('connection-terminal');
        const taken = yield* custodian.take(keyOf('take-terminal'), 0, connection, 'custodian');
        const claim: HostClaim = { connection, epoch: taken.standing.epoch, role: 'custodian' };
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const ended = yield* lifecycle.shutdown(claim, keyOf('shutdown-terminal'));
            if (ended._tag !== 'ShutdownComplete') return yield* Effect.die(new Error(`shutdown: ${JSON.stringify(ended)}`));
          }),
        );
        return yield* body({
          hostExecutions: yield* Executions,
          lanes: yield* InputLanes,
          stops: yield* ExecutionStop,
          byteRecords: yield* HostByteRecords,
          screens: yield* TerminalScreen,
          pacing: yield* PaceControl,
          bindings: yield* Bindings,
          claim,
          processes: yield* Processes,
          control: yield* ProcessControl,
        });
      }),
    ).pipe(Effect.provide(layer));
  },
  Effect.provide(hostSpawner),
  Effect.provide(BunServices.layer),
);

const lane = Effect.fnUntraced(function* (bindings: Bindings['Service'], claim: HostClaim) {
  const principal = principalOf('principal-operator');
  const binding = yield* bindings.open(principal, claim.connection, claim.epoch);
  return { binding: binding.id, principal, connection: claim.connection, epoch: claim.epoch };
});
const untilScreen = (screens: TerminalScreen['Service'], execution: ExecutionId, wanted: string) =>
  screens.screen(execution).pipe(
    Effect.flatMap((update) => {
      if (update._tag === 'ScreenTextFrame') {
        const text = update.rows.map((row) => row.text).join('\n');
        if (text.includes(wanted)) return Effect.succeed(text);
      }
      return Effect.fail('not-painted' as const);
    }),
    Effect.retry({ while: (failure) => failure === 'not-painted', schedule: Schedule.spaced('20 millis') }),
  );
const backgrounds = Effect.fnUntraced(function* (leader: number) {
  const processes = yield* Processes;
  const child = (yield* processes.table).find((row) => row.parent === leader && !row.zombie);
  return yield* Effect.forEach(child === undefined ? [leader] : [leader, child.pid], background);
});

describe('the interactive terminal vertical', () => {
  it.live('carries typed bytes, interrupt and geometry through a real shell, record and interpreter', () =>
    withTerminalHost({
      body: Effect.fnUntraced(function* ({ hostExecutions, lanes, stops, byteRecords, screens, bindings, claim }) {
        const typing = yield* lane(bindings, claim);
        const started = yield* hostExecutions.start(claim, keyOf('terminal-1'), launch('/bin/sh', []));
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const ref = started.execution;
        expect(
          (yield* lanes.admit(ref.execution, typing, {
            sequence: 0,
            cause: 'typed',
            act: { _tag: 'Write', bytes: new TextEncoder().encode('echo RUNLITH_MARK\n') },
          }))._tag,
        ).toBe('InputAdmitted');
        expect(yield* untilScreen(screens, ref.execution, 'RUNLITH_MARK')).toContain('RUNLITH_MARK');
        expect(yield* lanes.admit(ref.execution, typing, { sequence: 1, cause: 'interrupt', act: { _tag: 'Interrupt' } })).toMatchObject({
          _tag: 'InputAdmitted',
          receipt: { cause: 'interrupt', bytes: 1 },
        });
        yield* lanes.admit(ref.execution, typing, {
          sequence: 2,
          cause: 'typed',
          act: { _tag: 'Write', bytes: new TextEncoder().encode('echo AFTER_INTERRUPT\n') },
        });
        expect(yield* untilScreen(screens, ref.execution, 'AFTER_INTERRUPT')).toContain('AFTER_INTERRUPT');
        expect(
          yield* lanes.admit(ref.execution, typing, {
            sequence: 3,
            cause: 'resize',
            act: { _tag: 'Resize', geometry: { rows: 30, columns: 100 } },
          }),
        ).toMatchObject({ _tag: 'InputAdmitted', receipt: { bytes: 0 } });
        expect(yield* screens.screen(ref.execution)).toMatchObject({ _tag: 'ScreenTextFrame', geometry: { rows: 30, columns: 100 } });
        expect(
          yield* lanes.admit(ref.execution, typing, {
            sequence: 4,
            cause: 'resize',
            act: { _tag: 'Resize', geometry: { rows: 400, columns: 900 } },
          }),
        ).toMatchObject({ _tag: 'InputUnsupported', act: 'resize', reason: 'geometry' });
        expect(yield* screens.screen(ref.execution)).toMatchObject({ _tag: 'ScreenTextFrame', geometry: { rows: 30, columns: 100 } });
        const grids: (TerminalGeometry | undefined)[] = [];
        for (let offset = 0n; ;) {
          const read = yield* byteRecords.read({ ref, stream: 'pty', offset: byteOffset(offset) }, 4096);
          if (grids.length === 0 || !sameGeometry(grids.at(-1), read.range.grid)) grids.push(read.range.grid);
          if (read.bytes.length === 0) break;
          offset = offsetValue(read.range.next);
        }
        const receipt = yield* stops.stop(claim, keyOf('terminal-stop'), ref.execution, 'explicit-stop', 'destroy');
        expect(grids).toEqual([
          { rows: 24, columns: 80 },
          { rows: 30, columns: 100 },
        ]);
        expect(receipt.confirmed).toHaveLength(1);
        expect(receipt.abandonedOutput).toBe(true);
      }),
    }),
  );

  it.live('lets a principal without custody type through its first terminal lane and refuses that lane at another terminal', () =>
    withTerminalHost({
      executions: 2,
      body: Effect.fnUntraced(function* ({ hostExecutions, lanes, stops, screens, bindings, claim }) {
        const viewer = principalOf('principal-viewer');
        const opened = yield* bindings.open(viewer, claim.connection, claim.epoch);
        const first = yield* hostExecutions.start(claim, keyOf('lane-terminal-1'), launch('/bin/sh', []));
        const second = yield* hostExecutions.start(claim, keyOf('lane-terminal-2'), launch('/bin/sh', []));
        if (first._tag !== 'Started' || second._tag !== 'Started')
          return yield* Effect.die(new Error(`start: ${first._tag}/${second._tag}`));
        const typing = { binding: opened.id, principal: viewer, connection: claim.connection, epoch: claim.epoch };
        expect(
          (yield* lanes.admit(first.execution.execution, typing, {
            sequence: 0,
            cause: 'typed',
            act: { _tag: 'Write', bytes: new TextEncoder().encode('echo LANE_$((6*7))\n') },
          }))._tag,
        ).toBe('InputAdmitted');
        expect(yield* untilScreen(screens, first.execution.execution, 'LANE_42')).toContain('LANE_42');
        expect(
          yield* lanes.admit(first.execution.execution, typing, { sequence: 1, cause: 'interrupt', act: { _tag: 'Interrupt' } }),
        ).toMatchObject({ _tag: 'InputAdmitted', receipt: { cause: 'interrupt', bytes: 1 } });
        expect(
          (yield* lanes.admit(first.execution.execution, typing, {
            sequence: 2,
            cause: 'resize',
            act: { _tag: 'Resize', geometry: { rows: 30, columns: 100 } },
          }))._tag,
        ).toBe('InputAdmitted');
        expect(yield* screens.screen(first.execution.execution)).toMatchObject({
          _tag: 'ScreenTextFrame',
          geometry: { rows: 30, columns: 100 },
        });
        expect(
          yield* Effect.flip(
            lanes.admit(second.execution.execution, typing, {
              sequence: 0,
              cause: 'resize',
              act: { _tag: 'Resize', geometry: { rows: 30, columns: 100 } },
            }),
          ),
        ).toMatchObject({ _tag: 'LaneRefused' });
        expect(yield* screens.screen(second.execution.execution)).toMatchObject({
          _tag: 'ScreenTextFrame',
          geometry: { rows: 24, columns: 80 },
        });
        yield* stops.stop(claim, keyOf('lane-terminal-stop-1'), first.execution.execution, 'explicit-stop', 'destroy');
        yield* stops.stop(claim, keyOf('lane-terminal-stop-2'), second.execution.execution, 'explicit-stop', 'destroy');
      }),
    }),
  );

  it.live('takes a shell that traps hang-up and terminate down the whole ladder while retaining its output', () =>
    withTerminalHost({
      body: Effect.fnUntraced(function* ({ hostExecutions, stops, screens, claim }) {
        const started = yield* hostExecutions.start(
          claim,
          keyOf('trap-1'),
          launch('/bin/sh', ['-c', "trap 'echo TRAPPED' HUP TERM; echo ARMED; while :; do sleep 0.05; done"]),
        );
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const execution = started.execution.execution;
        yield* untilScreen(screens, execution, 'ARMED');
        expect((yield* stops.signal(claim, execution, 'SIGTERM'))._tag).toBe('Delivered');
        expect(yield* untilScreen(screens, execution, 'TRAPPED')).toContain('TRAPPED');
        expect((yield* hostExecutions.summary(execution))?.state.nativeExit).toBeUndefined();
        const began = yield* Clock.monotonicTimeNanos;
        const receipt = yield* stops.stop(claim, keyOf('trap-signal'), execution, 'explicit-stop', 'signal');
        const tookMs = Number((yield* Clock.monotonicTimeNanos) - began) / 1_000_000;
        expect(receipt).toMatchObject({
          requested: 'signal',
          steps: ['hang-up', 'terminate', 'kill'],
          cleanup: 'complete',
          coverage: ['leader', 'ancestry'],
          relation: 'covered',
          residual: [],
          abandonedOutput: false,
        });
        expect(receipt.confirmed).toHaveLength(1);
        expect(receipt.confirmed[0]).toMatchObject({ step: 'kill', exit: { _tag: 'Signal', signal: 'SIGKILL' } });
        expect(tookMs).toBeGreaterThanOrEqual(STOP_LADDER.killAtMs);
        const after = yield* screens.screen(execution);
        expect(after._tag).toBe('ScreenTextFrame');
        if (after._tag === 'ScreenTextFrame') expect(after.rows.map((row) => row.text).join('\n')).toContain('TRAPPED');
      }),
    }),
  );

  it.live('ends an interactive bash on hang-up without escalation', () =>
    withTerminalHost({
      body: Effect.fnUntraced(function* ({ hostExecutions, stops, screens, claim }) {
        const started = yield* hostExecutions.start(
          claim,
          keyOf('hangup-1'),
          launch('/bin/bash', ['--noprofile', '--norc', '-i', '-c', 'printf BASH_ARMED; read -r line']),
        );
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        yield* untilScreen(screens, started.execution.execution, 'BASH_ARMED');
        const began = yield* Clock.monotonicTimeNanos;
        const receipt = yield* stops.stop(claim, keyOf('hangup-stop'), started.execution.execution, 'explicit-stop', 'signal');
        const tookMs = Number((yield* Clock.monotonicTimeNanos) - began) / 1_000_000;
        expect(receipt.steps).toEqual(['hang-up']);
        expect(receipt.confirmed.map((ending) => [ending.relation, ending.step])).toEqual([['leader', 'hang-up']]);
        expect(receipt.confirmed[0]?.exit).toEqual({ _tag: 'Signal', signal: 'SIGHUP' });
        expect(receipt.cleanup).toBe('complete');
        expect(tookMs).toBeLessThan(STOP_LADDER.terminateAtMs);
      }),
    }),
  );

  it.live('ends the work a terminal child forked and measures its ancestry rather than the leader alone', () =>
    withTerminalHost({
      body: Effect.fnUntraced(function* ({ hostExecutions, stops, screens, processes, control, claim }) {
        const started = yield* hostExecutions.start(
          claim,
          keyOf('terminal-fork-1'),
          launch('/bin/sh', ['-c', 'sh -c \'trap "" HUP; echo FORK_ARMED; exec sleep 30\' & exec sleep 30']),
        );
        if (started._tag !== 'Started' || started.native.pid === undefined) return yield* Effect.die(new Error(`start: ${started._tag}`));
        const leader = started.native.pid;
        yield* untilScreen(screens, started.execution.execution, 'FORK_ARMED');
        const rows = yield* processes.table;
        const child = rows.find((row) => row.parent === leader && !row.zombie);
        if (child === undefined) return yield* Effect.die(new Error('the terminal fork was not in the kernel table'));
        const relations = new ProcessTree(rows.map((row) => ({ identity: row, parent: row.parent, work: row.work }))).relations(
          { pid: leader },
          false,
        );
        const members = rows.filter((row) => row.pid !== leader && relations.has(row.pid));
        yield* Effect.addFinalizer(() =>
          Effect.forEach(
            members,
            Effect.fnUntraced(function* (witness) {
              const delivery = yield* control.act(witness, 'kill');
              if (delivery === 'unreadable' || delivery === 'refused') return yield* Effect.die(new Error(`fork cleanup: ${delivery}`));
            }),
            { discard: true },
          ),
        );
        const receipt = yield* stops.stop(claim, keyOf('terminal-fork-stop'), started.execution.execution, 'explicit-stop', 'signal');
        expect(yield* control.standing(child)).toBe('gone');
        expect(receipt).toMatchObject({
          coverage: ['leader', 'ancestry'],
          relation: 'covered',
          residual: [],
          cleanup: 'complete',
          abandonedOutput: false,
          steps: ['hang-up', 'terminate'],
        });
      }),
    }),
  );

  (process.platform === 'darwin' ? it.live : it.live.skip)(
    'backgrounds a paced terminal and its child under lowest, then returns them to full',
    () =>
      withTerminalHost({
        body: Effect.fnUntraced(function* ({ hostExecutions, stops, pacing, claim }) {
          expect(yield* pacing.set(claim, 'lowest')).toMatchObject({ _tag: 'Applied', pace: 'lowest', failed: 0 });
          const started = yield* hostExecutions.start(claim, keyOf('terminal-paced'), {
            ...launch('/bin/sh', ['-c', 'sleep 0.3; sleep 30']),
            paced: true,
          });
          if (started._tag !== 'Started' || started.native.pid === undefined) return yield* Effect.die(new Error(`start: ${started._tag}`));
          const leader = started.native.pid;
          const atLowest = yield* backgrounds(leader).pipe(
            Effect.repeat({ until: (read) => read.length === 2 && read.every(Boolean), schedule: Schedule.spaced('100 millis') }),
          );
          expect(atLowest).toEqual([true, true]);
          expect(yield* pacing.set(claim, 'full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 2, kept: 0, failed: 0 });
          const atFull = yield* backgrounds(leader);
          yield* stops.stop(claim, keyOf('terminal-paced-stop'), started.execution.execution, 'explicit-stop', 'destroy');
          expect(atFull).toEqual([false, false]);
        }),
      }),
  );

  it.live('stops a terminal flooding beyond retention and returns a contiguous byte-exact retained window', () =>
    withTerminalHost({
      body: Effect.fnUntraced(function* ({ hostExecutions, stops, byteRecords, claim }) {
        const started = yield* hostExecutions.start(
          claim,
          keyOf('stop-flood-pty-1'),
          launch('/bin/sh', ['-c', 'stty raw -echo; awk \'BEGIN{for(i=0;i<200000;i++) printf "%050d\\n", i}\'']),
        );
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const ref = started.execution;
        const retention = BigInt((yield* ExecutionCapacity).profile.execution.output.retainedBytes);
        yield* hostExecutions.summary(ref.execution).pipe(
          Effect.repeat({
            until: (summary) => {
              const pty = summary?.streams.find((positions) => positions.stream === 'pty');
              return pty !== undefined && offsetValue(pty.durableThrough) > retention;
            },
            schedule: Schedule.spaced('10 millis'),
          }),
        );
        const receipt = yield* stops.stop(claim, keyOf('stop-flood-pty-op-1'), ref.execution, 'explicit-stop', 'signal');
        const drained = yield* hostExecutions.summary(ref.execution).pipe(
          Effect.repeat({
            until: (summary) => {
              const pty = summary?.streams.find((positions) => positions.stream === 'pty');
              return pty !== undefined && pty.ending !== 'open';
            },
            schedule: Schedule.spaced('10 millis'),
          }),
        );
        const pty = drained?.streams.find((positions) => positions.stream === 'pty');
        if (pty === undefined) return yield* Effect.die(new Error('the ended terminal has no stream frontier'));
        let held = '';
        for (let offset = offsetValue(pty.retainedFrom); ;) {
          const read = yield* byteRecords.read({ ref, stream: 'pty', offset: byteOffset(offset) }, 65536);
          held += new TextDecoder().decode(read.bytes);
          const next = offsetValue(read.range.next);
          if ((!read.range.gap && next >= offsetValue(pty.durableThrough)) || next <= offset) break;
          offset = next;
        }
        expect(receipt).toMatchObject({
          cause: 'explicit-stop',
          coverage: ['leader', 'ancestry'],
          relation: 'covered',
          residual: [],
          unverifiable: [],
          cleanup: 'complete',
        });
        expect(receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader']);
        expect(offsetValue(pty.durableThrough)).toBeGreaterThan(retention);
        expect(offsetValue(pty.retainedFrom) <= offsetValue(pty.durableThrough)).toBe(true);
        const fragments = held.split('\n');
        fragments.pop();
        if (offsetValue(pty.retainedFrom) > 0n) fragments.shift();
        const numbers = fragments.map(Number);
        expect(numbers.length).toBeGreaterThan(0);
        expect(numbers.every(Number.isInteger)).toBe(true);
        expect(numbers.every((number, index) => index === 0 || number === numbers[index - 1]! + 1)).toBe(true);
        if (offsetValue(pty.retainedFrom) === 0n) expect(numbers[0]).toBe(0);
      }),
    }),
  );
});
