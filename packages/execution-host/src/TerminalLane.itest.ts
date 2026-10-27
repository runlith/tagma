import { describe, expect } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Deferred, Effect, Exit, FileSystem, Layer, Queue, Schedule, Schema } from 'effect';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { LANE_PATH, LaneReplyText, readOutputFrame, type LaneReply } from '@runlith/executions/protocol/lane';
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

const CLIENT = join(import.meta.dir, 'testing/laneClient.ts');
const BLOCK_MS = 2000;
const ECHO_MS = 100;
const QUEUE_SLACK_MS = 10;

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

type Measured = {
  readonly started: number;
  readonly finished: number;
  readonly command: number;
  readonly keys: ReadonlyArray<number>;
  readonly receipts: ReadonlyArray<number>;
};

const blocking = Effect.fnUntraced(function* (signalled: number) {
  process.kill(signalled, 'SIGUSR2');
  const from = yield* Clock.currentTimeMillis;
  yield* Effect.sync(() => {
    const until = performance.now() + BLOCK_MS;
    while (performance.now() < until);
  });
  return { from, to: yield* Clock.currentTimeMillis };
});

const client = Effect.fnUntraced(function* (url: string, token: string, next: number) {
  const lines = yield* Queue.unbounded<string>();
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, CLIENT, url, token, String(next)], { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }),
    ),
    (spawned) =>
      Effect.promise(async () => {
        spawned.kill('SIGKILL');
        await spawned.exited;
      }),
  );
  yield* Effect.forkScoped(
    Effect.promise(async () => {
      const decoder = new TextDecoder();
      let held = '';
      for await (const chunk of child.stdout) {
        held += decoder.decode(chunk, { stream: true });
        for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
          Queue.offerUnsafe(lines, held.slice(0, at));
          held = held.slice(at + 1);
        }
      }
    }),
  );
  return { pid: child.pid, line: Effect.map(Queue.take(lines), (line) => JSON.parse(line) as Record<string, unknown>) };
});

const viewer = Effect.fnUntraced(function* (url: string, token: string) {
  const replies = yield* Queue.unbounded<string>();
  const frames = yield* Queue.unbounded<{ readonly offset: bigint; readonly bytes: Uint8Array }>();
  const closed = yield* Deferred.make<number>();
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = new WebSocket(url);
      opened.binaryType = 'arraybuffer';
      opened.onopen = () => opened.send(JSON.stringify({ lane: token }));
      opened.onmessage = (event) => {
        if (typeof event.data === 'string') return Queue.offerUnsafe(replies, event.data);
        const frame = readOutputFrame(new Uint8Array(event.data as ArrayBuffer));
        if (frame !== undefined) Queue.offerUnsafe(frames, { offset: frame.offset, bytes: frame.bytes.slice() });
      };
      opened.onclose = (event) => Deferred.doneUnsafe(closed, Exit.succeed(event.code));
      return opened;
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  return {
    reply: Effect.flatMap(Queue.take(replies), (text) => Schema.decodeUnknownEffect(LaneReplyText)(text)),
    frame: Queue.take(frames),
    closed: Deferred.await(closed),
    send: (said: unknown) => Effect.sync(() => socket.send(JSON.stringify(said))),
  };
});

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

        const typist = yield* client(url, lane.token, lane.next);
        expect(yield* typist.line).toHaveProperty('ready');
        const blocked = yield* blocking(typist.pid);
        const measured = (yield* typist.line) as Measured;
        const said = JSON.stringify(measured);
        expect(measured.started, said).toBeGreaterThanOrEqual(blocked.from);
        expect(measured.finished, said).toBeLessThanOrEqual(blocked.to);
        expect(measured.command, said).toBeLessThan(ECHO_MS);
        expect(measured.keys, said).toHaveLength(20);
        expect(Math.max(...measured.keys), said).toBeLessThan(ECHO_MS);
        expect(measured.keys[19]!, said).toBeLessThan(measured.keys[0]! + QUEUE_SLACK_MS);
        expect(measured.receipts.every(Number.isFinite), said).toBe(true);

        const watching = yield* viewer(url, lane.token);
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
        const stale = yield* viewer(url, other.token);
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
