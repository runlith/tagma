import { describe, expect } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { LANE_PATH, type LaneReply } from '@runlith/executions/protocol/lane';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { InputLanes } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostLifecycle } from './registry/shutdown';
import { HostByteRecords } from './registry/reads';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { laneTypist } from './testing/laneTypist';
import { laneViewer } from './testing/laneViewer';

const GRID = { rows: 30, columns: 100 };

const shell: LaunchRequest = {
  command: {
    program: '/bin/sh',
    args: [],
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
};

const withTerminalHost = Effect.fnUntraced(
  function* <A, E, R>(body: Effect.Effect<A, E, R>) {
    const files = yield* FileSystem.FileSystem;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-lane-' });
    const state = hostState(`${directory}/executions.sqlite`, registrationOf(directory), yield* sharedPool).pipe(
      Layer.provideMerge(ExecutionCapacity.layer(runtimeProfile({ transports: ['pty'], rows: 40, columns: 120, executions: 1 }))),
    );
    const layer = ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(state),
      Layer.provideMerge(testHolder(directory)),
    );
    return yield* Effect.scoped(body).pipe(Effect.provide(layer));
  },
  Effect.provide(hostSpawner),
  Effect.provide(BunServices.layer),
);

describe('the terminal endpoint', () => {
  it.live('types into a real shell and follows its output past a blocked logic thread, byte for byte with the record', () =>
    withTerminalHost(
      Effect.gen(function* () {
        const custodian = yield* Custodian;
        const lifecycle = yield* HostLifecycle;
        const executions = yield* Executions;
        const lanes = yield* InputLanes;
        const records = yield* HostByteRecords;
        const stops = yield* ExecutionStop;
        const bindings = yield* Bindings;
        const connection = connectionOf('connection-lane');
        const taken = yield* custodian.take(keyOf('take-lane'), 0, connection, 'custodian');
        const claim = { connection, epoch: taken.standing.epoch, role: 'custodian' as const };
        let holding = claim;
        yield* Effect.addFinalizer(() => Effect.asVoid(Effect.suspend(() => lifecycle.shutdown(holding, keyOf('shutdown-lane')))));
        const principal = principalOf('principal-operator');
        const binding = yield* bindings.open(principal, connection, claim.epoch);
        const started = yield* executions.start(claim, keyOf('lane-shell'), shell);
        if (started._tag !== 'Started') return yield* Effect.die(new Error(`start: ${started._tag}`));
        const ref = started.execution;
        const lane = yield* lanes.open(ref.execution, { binding: binding.id, principal, connection, epoch: claim.epoch });
        const url = `ws://127.0.0.1:${lane.port}${LANE_PATH}`;

        const typist = yield* laneTypist(url, lane.token, lane.next);
        expect(yield* typist.line).toHaveProperty('ready');
        const grid = yield* bindings.open(principal, connection, claim.epoch);
        yield* Effect.yieldNow;
        const resizing = yield* Effect.forkChild(
          Effect.zip(
            lanes.admit(
              ref.execution,
              { binding: grid.id, principal, connection, epoch: claim.epoch },
              { sequence: 0, cause: 'resize', act: { _tag: 'Resize', geometry: GRID } },
            ),
            Clock.currentTimeMillis,
          ),
          { startImmediately: true },
        );
        const typed = yield* typist.typed;
        const [resized, resizedAt] = yield* Fiber.join(resizing);
        expect(typed.size, typed.said).toBe(`${GRID.rows} ${GRID.columns}`);
        expect(resizedAt).toBeGreaterThanOrEqual(typed.to);
        expect(resized).toMatchObject({ _tag: 'InputAdmitted', receipt: { sequence: 0, cause: 'resize' } });
        expect((yield* executions.summary(ref.execution))?.grid).toEqual(GRID);
        expect(typed.keys, typed.said).toHaveLength(20);
        expect(typed.receipts.every(Number.isFinite), typed.said).toBe(true);

        const watching = yield* laneViewer(url, lane.token);
        const ready = (yield* watching.reply) as Extract<LaneReply, { readonly t: 'ready' }>;
        expect(ready).toMatchObject({ t: 'ready', execution: ref.execution });
        const from = offsetValue(ready.head) / 3n;
        yield* watching.send({ t: 'follow', offset: String(from) });
        yield* watching.send({
          t: 'act',
          sequence: lane.next + 21,
          cause: 'typed',
          act: { _tag: 'Write', bytes: Buffer.from('\nseq 1 3000\n').toString('base64') },
        });
        const live: Uint8Array[] = [];
        let end = from;
        for (let text = ''; !text.includes('\n3000\r\n');) {
          const frame = yield* watching.frame;
          expect(frame.offset).toBe(end);
          live.push(frame.bytes);
          end += BigInt(frame.bytes.length);
          text += new TextDecoder().decode(frame.bytes);
        }
        expect(yield* watching.reply).toMatchObject({ t: 'receipt', answer: { _tag: 'InputAdmitted' } });
        yield* executions.summary(ref.execution).pipe(
          Effect.repeat({
            until: (summary) => {
              const pty = summary?.streams.find((positions) => positions.stream === 'pty');
              return pty !== undefined && offsetValue(pty.durableThrough) >= end;
            },
            schedule: Schedule.spaced('10 millis'),
          }),
        );
        const recorded: Uint8Array[] = [];
        for (let offset = from; offset < end;) {
          const read = yield* records.read({ ref, stream: 'pty', offset: byteOffset(offset) }, Number(end - offset));
          if (read.bytes.length === 0) break;
          recorded.push(read.bytes);
          offset = offsetValue(read.range.next);
        }
        expect(Buffer.concat(live).equals(Buffer.concat(recorded))).toBe(true);

        yield* lanes.close(binding.id, principal);
        expect(yield* watching.closed).toBe(4410);

        const later = yield* bindings.open(principal, connection, claim.epoch);
        const other = yield* lanes.open(ref.execution, { binding: later.id, principal, connection, epoch: claim.epoch });
        const stale = yield* laneViewer(url, other.token);
        expect(yield* stale.reply).toMatchObject({ t: 'ready' });
        const successor = connectionOf('connection-lane-next');
        const retaken = yield* custodian.take(keyOf('take-lane-next'), taken.standing.revision, successor, 'custodian');
        holding = { connection: successor, epoch: retaken.standing.epoch, role: 'custodian' };
        expect(yield* stale.closed).toBe(4410);
        yield* stops.stop(holding, keyOf('lane-shell-stop'), ref.execution, 'explicit-stop', 'destroy');
      }),
    ),
  );
});
