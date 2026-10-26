import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Duration, Effect, Fiber, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { WireUnavailable } from '@runlith/executions/Executions';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { TerminalRecord, TerminalWaitAnswer } from '../contract/wire/terminals.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { makeTerminalEndings } from './endings.js';
import type { TerminalWatched } from '../contract/service/endings.js';
import { Terminals } from '../contract/service/terminals.js';
import { Discharge, type TerminalDischarge } from '../contract/service/discharge.js';
import { TerminalRows } from '../store/terminalRows.js';
import { CommandRows } from '../store/commandRows.js';

const INSTALLATION = InstallationId.make('endings');
const ref: ExecutionRef = { installation: INSTALLATION, execution: ExecutionId.make('exec-1'), incarnation: 1 };
const watched: TerminalWatched = { projectId: 7, execution: ref };

const summary: ExecutionSummary = {
  state: {
    ref,
    transport: 'pipes',
    lifetime: 'held',
    purpose: 'command',
    phase: 'ended',
    streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
    cleanup: 'complete',
    record: 'available',
  },
  custody: {
    revision: 1,
    holder: Principal.make('thread:alpha'),
    origin: Principal.make('thread:alpha'),
    target: { environment: 'host', namespace: 'machine', cwd: '/tmp', dependencies: [] },
  },
  streams: [],
  native: { pid: 4242 },
  input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
};

const decided: TerminalWaitAnswer = { _tag: 'Decided', summary };
const undecided: TerminalWaitAnswer = { _tag: 'Undecided', summary };
const unreachable = new WireUnavailable({ kind: 'unreachable', reason: 'the host does not answer', sent: false });

const row = { projectId: 7, execution: ref } as unknown as TerminalRecord;

const roadOver = Effect.fnUntraced(function* (
  wait: (waitMs: number) => Effect.Effect<TerminalWaitAnswer, WireUnavailable>,
  discharge: TerminalDischarge = { _tag: 'Discharged' },
) {
  const counts = { waits: 0, ended: 0 };
  const entered = yield* Queue.unbounded<number>();
  const settled = yield* Queue.unbounded<number>();
  const terminals = {
    wait: (_execution: ExecutionRef, waitMs: number) => {
      counts.waits += 1;
      return Effect.andThen(Queue.offer(entered, counts.waits), wait(waitMs));
    },
    ended: () => {
      counts.ended += 1;
      return Effect.andThen(Queue.offer(settled, counts.ended), Effect.succeed(discharge));
    },
    dischargeReplaced: () => Effect.succeed<TerminalDischarge>({ _tag: 'Retained', reason: 'not-replaced' }),
  } as unknown as Terminals['Service'] & Discharge['Service'];
  return { counts, entered, settled, terminals };
});

const units = { read: (work: (unit: never) => unknown) => work(undefined as never) } as unknown as MachineUnits['Service'];

const endingsOver = Effect.fnUntraced(function* (
  terminals: Terminals['Service'] & Discharge['Service'],
  held: readonly TerminalRecord[] = [],
) {
  const opened = yield* Queue.unbounded<TerminalWatched>();
  const ended = yield* Queue.unbounded<ExecutionRef>();
  const endings = yield* makeTerminalEndings({ opened, ended }).pipe(
    Effect.provide(
      Context.make(Terminals, terminals).pipe(
        Context.add(Discharge, terminals),
        Context.add(TerminalRows, { held: () => Effect.succeed(held) } as unknown as TerminalRows),
        Context.add(CommandRows, { commandsHeld: () => Effect.succeed([]) } as unknown as CommandRows),
        Context.add(MachineUnits, units),
      ),
    ),
  );
  return { endings, opened, ended };
});

it.effect('an execution the host decided is discharged once, and every caller reads that decision', () =>
  Effect.gen(function* () {
    const road = yield* roadOver(() => Effect.succeed(decided));
    const { endings } = yield* endingsOver(road.terminals);
    const first = yield* Effect.forkChild(endings.decided(watched));
    const second = yield* Effect.forkChild(endings.decided(watched));
    const answers = [yield* Fiber.join(first), yield* Fiber.join(second)];
    expect(yield* Queue.take(road.settled)).toBe(1);

    expect(answers.map((answer) => answer._tag)).toEqual(['Decided', 'Decided']);
    expect(answers[0]?._tag === 'Decided' ? answers[0].summary.state.phase : '').toBe('ended');
    expect(road.counts).toEqual({ waits: 1, ended: 1 });
  }),
);

it.effect('a host that cannot be reached leaves custody standing, and the watch resumes when it answers', () =>
  Effect.gen(function* () {
    let attempt = 0;
    const road = yield* roadOver(() => {
      attempt += 1;
      return attempt === 1 ? Effect.fail(unreachable) : Effect.succeed(decided);
    });
    const { endings } = yield* endingsOver(road.terminals);
    const watching = yield* Effect.forkChild(endings.decided(watched));
    expect(yield* Queue.take(road.entered)).toBe(1);
    yield* Effect.yieldNow;
    expect(road.counts.ended).toBe(0);
    yield* TestClock.adjust(Duration.seconds(5));
    const answer = yield* Fiber.join(watching);
    expect(yield* Queue.take(road.settled)).toBe(1);

    expect(answer._tag).toBe('Decided');
    expect(road.counts).toEqual({ waits: 2, ended: 1 });
  }),
);

it.effect('an execution nobody decides costs one renewal per expiry and discharges nothing', () =>
  Effect.gen(function* () {
    const road = yield* roadOver((waitMs) => Effect.as(Effect.sleep(Duration.millis(waitMs)), undecided));
    const { endings } = yield* endingsOver(road.terminals);
    const watching = yield* Effect.forkChild(endings.decided(watched));
    const opening = yield* Queue.take(road.entered);
    yield* TestClock.adjust(Duration.minutes(1));
    const renewed = yield* Queue.take(road.entered);
    yield* Fiber.interrupt(watching);

    expect({ opening, renewed, ended: road.counts.ended }).toEqual({ opening: 1, renewed: 2, ended: 0 });
  }),
);

it.effect('a retained discharge leaves the work where it stands, and the caller still reads the ending', () =>
  Effect.gen(function* () {
    const road = yield* roadOver(() => Effect.succeed(decided), { _tag: 'Retained', reason: 'residual' });
    const { endings } = yield* endingsOver(road.terminals);
    const answer = yield* endings.decided(watched);
    expect(yield* Queue.take(road.settled)).toBe(1);

    expect(answer._tag).toBe('Decided');
    expect(road.counts).toEqual({ waits: 1, ended: 1 });
  }),
);

it.effect('an ending the host has not published yet holds the watch, and discharges when it lands', () =>
  Effect.gen(function* () {
    let attempt = 0;
    const counts = { waits: 0, ended: 0 };
    const settled = yield* Queue.unbounded<number>();
    const terminals = {
      wait: () => {
        counts.waits += 1;
        return Effect.succeed(decided);
      },
      ended: () => {
        counts.ended += 1;
        attempt += 1;
        return Effect.andThen(
          Queue.offer(settled, attempt),
          Effect.succeed<TerminalDischarge>(attempt === 1 ? { _tag: 'Retained', reason: 'unended' } : { _tag: 'Discharged' }),
        );
      },
    } as unknown as Terminals['Service'] & Discharge['Service'];
    const { endings } = yield* endingsOver(terminals);
    const answer = yield* endings.decided(watched);
    expect(yield* Queue.take(settled)).toBe(1);
    yield* TestClock.adjust(Duration.seconds(5));
    expect(yield* Queue.take(settled)).toBe(2);

    expect(answer._tag).toBe('Decided');
    expect(counts).toEqual({ waits: 1, ended: 2 });
  }),
);

it.effect('a reference the host holds nothing under answers unwatchable, discharges nothing, and still hands the ending on', () =>
  Effect.gen(function* () {
    const road = yield* roadOver(() => Effect.succeed({ _tag: 'Unwatchable' }));
    const { endings, ended } = yield* endingsOver(road.terminals);
    const answer = yield* endings.decided(watched);
    const owed = yield* Queue.take(ended);

    expect(answer._tag).toBe('Unwatchable');
    expect(road.counts).toEqual({ waits: 1, ended: 0 });
    expect(owed).toEqual(ref);
  }),
);

it.effect('a discharge that keeps its custody still hands the ending on, so what is owed for it can settle', () =>
  Effect.gen(function* () {
    const road = yield* roadOver(() => Effect.succeed(decided), { _tag: 'Retained', reason: 'foreign-reference' });
    const { endings, ended } = yield* endingsOver(road.terminals);
    yield* endings.decided(watched);

    expect(yield* Queue.take(ended)).toEqual(ref);
  }),
);

it.effect('a boot watches every execution a thread still holds, and an accepted start is taken from the queue', () =>
  Effect.gen(function* () {
    const road = yield* roadOver(() => Effect.succeed(decided));
    const { endings, opened } = yield* endingsOver(road.terminals, [row]);
    const resumed = yield* endings.resume();
    const atBoot = { resumed, discharged: yield* Queue.take(road.settled) };
    yield* Effect.forkChild(endings.attend());
    yield* Queue.offer(opened, { projectId: 7, execution: { ...ref, incarnation: 2 } });

    expect(atBoot).toEqual({ resumed: 1, discharged: 1 });
    expect(yield* Queue.take(road.settled)).toBe(2);
  }),
);
