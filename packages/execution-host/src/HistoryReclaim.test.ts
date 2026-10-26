import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TestClock } from 'effect/testing';
import { Effect } from 'effect';
import { CapabilityProfile } from '@runlith/executions/protocol/capacity';
import { ExecutionRef, ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from './ExecutionCapacity';
import { type HistoryReclaim, makeHistoryReclaim } from './HistoryReclaim';
import { makeInterpretation } from './Interpretation';
import { makePresentation } from './Presentation';
import { runtimeProfile } from './runtimeFixture';

const installation = InstallationId.make('installation-1');

const COLORS = {
  palette: Array.from({ length: 256 }, (_, index) => index * 0x010101),
  foreground: 0xe5e5e5,
  background: 0x000000,
  cursor: 0xe5e5e5,
};

const profile = runtimeProfile({ executions: 12, rows: 4, columns: 20, scrollbackRows: 40, transports: ['pty'] });
const limits = profile.execution;
const CAP = limits.parser.cellBytes;

const LINE = `\u001b[4:3m${'x'.repeat(19)}\u001b[0m\r\n`;
const bytes = (text: string) => new TextEncoder().encode(text);

type Host = {
  readonly capacity: ExecutionCapacity['Service'];
  readonly reclaim: HistoryReclaim;
};

const withHost = Effect.fnUntraced(function* <A, E, R>(body: (host: Host) => Effect.Effect<A, E, R>, over: CapabilityProfile = profile) {
  return yield* Effect.gen(function* () {
    const capacity = yield* ExecutionCapacity;
    const reclaim = yield* makeHistoryReclaim;
    return yield* body({ capacity, reclaim });
  }).pipe(Effect.provide(ExecutionCapacity.layer(over)));
}, Effect.scoped);

const terminal = Effect.fnUntraced(function* (
  host: Host,
  index: number,
  lines = limits.geometry.scrollbackRows + limits.geometry.rows + 1,
) {
  const execution = ExecutionId.make(`execution-${index}`);
  const ref = ExecutionRef.make({ installation, execution, incarnation: 0 });
  yield* host.capacity.reserve(execution, 'pty');
  const interpretation = yield* makeInterpretation({
    mode: 'open',
    ref,
    geometry: { rows: limits.geometry.rows, columns: limits.geometry.columns },
    limits,
    colors: COLORS,
    reply: () => Effect.succeed({ delivered: true, ending: false, detail: '' }),
  });
  const presentation = yield* makePresentation({
    interpretation,
    limits,
    ref: ref,
  });
  yield* host.reclaim.hold(execution, interpretation, presentation);
  for (let line = 0; line < lines; line += 1) yield* interpretation.feed(bytes(LINE));
  yield* host.reclaim.measure(execution);
  return { execution, interpretation, presentation };
});

type Terminal = Effect.Success<ReturnType<typeof terminal>>;

const pressureTerminals = Effect.fnUntraced(function* (host: Host) {
  yield* TestClock.adjust('1 millis');
  const terminals = [yield* terminal(host, 0)];
  const retained = yield* terminals[0]!.interpretation.retained();
  expect(retained).toBeGreaterThan(0);
  const count = Math.max(3, Math.floor((2 * CAP) / retained) + 1);
  for (let index = 1; index < count; index += 1) {
    yield* TestClock.adjust('1 millis');
    terminals.push(yield* terminal(host, index));
  }
  return terminals;
});

const standingOf = (held: Terminal) => Effect.all({ retained: held.interpretation.retained(), history: held.interpretation.historyRows() });

const grantLeaving = Effect.fnUntraced(function* (host: Host, room: number) {
  const ledger = yield* host.capacity.ledger();
  const grant = room + ledger.reserved + CAP;
  return yield* host.capacity.regrant(grant / ledger.granted.machineBytes);
});

const markOf = (host: Host) =>
  Effect.map(host.capacity.ledger(), (ledger) => Math.max(0, ledger.granted.grantBytes - ledger.reserved - CAP));

describe('reclaim gives history back before a host refuses a start', () => {
  it.effect('trims the oldest terminals to the mark, leaves the freshest whole, and ends nothing', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost((host) =>
        Effect.gen(function* () {
          const terminals = yield* pressureTerminals(host);
          const before = yield* Effect.forEach(terminals, standingOf);
          const lowered = yield* grantLeaving(host, before.reduce((sum, entry) => sum + entry.retained, 0) / 2);
          const stop = yield* markOf(host);
          const pass = yield* host.reclaim.reclaim();
          const after = yield* Effect.forEach(terminals, standingOf);
          const alive = yield* Effect.forEach(terminals, (held) =>
            Effect.map(Effect.result(held.interpretation.feed(bytes('ok'))), (fed) => fed._tag === 'Success'),
          );
          return { over: lowered.over, stop, pass, before, after, alive };
        }),
      );

      expect(outcome.over).toBeGreaterThan(0);
      expect(outcome.pass.standing.retained).toBeLessThanOrEqual(outcome.stop);
      expect(outcome.pass.standing.over).toBe(0);

      const gave = outcome.after.flatMap((held, index) => (held.retained < (outcome.before[index]?.retained ?? 0) ? [index] : []));
      const kept = outcome.after.flatMap((held, index) => (held.retained === outcome.before[index]?.retained ? [index] : []));
      expect(gave.length).toBeGreaterThan(0);
      expect(kept.length).toBeGreaterThan(0);
      expect(Math.max(...gave)).toBeLessThan(Math.min(...kept));
      for (const index of kept) expect(outcome.after[index]?.history).toBe(outcome.before[index]?.history);
      const counted = outcome.pass.trimmed.reduce((sum, taken) => sum + taken.rows, 0);
      const lost = outcome.before.reduce((sum, held, index) => sum + held.history - (outcome.after[index]?.history ?? 0), 0);
      expect(counted).toBe(lost);
      expect(counted).toBeGreaterThan(0);
      expect(outcome.alive).toEqual(outcome.before.map(() => true));
    }),
  );

  it.effect('trims unwatched history before an older watched terminal', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost((host) =>
        Effect.gen(function* () {
          const terminals = yield* pressureTerminals(host);
          yield* host.capacity.reserveReader(terminals[0]!.execution);
          const before = yield* Effect.forEach(terminals, standingOf);
          const lowered = yield* grantLeaving(host, 2 * (before[0]?.retained ?? 0));
          const stop = yield* markOf(host);
          const pass = yield* host.reclaim.reclaim();
          const after = yield* Effect.forEach(terminals, standingOf);
          return { over: lowered.over, stop, pass, before, after };
        }),
      );

      expect(outcome.over).toBeGreaterThan(0);
      expect(outcome.pass.standing.retained).toBeLessThanOrEqual(outcome.stop);
      expect(outcome.after[0]?.retained).toBe(outcome.before[0]?.retained);
      expect(outcome.after[0]?.history).toBe(outcome.before[0]?.history);
      for (let index = 1; index < outcome.after.length; index += 1) {
        expect(outcome.after[index]?.retained).toBeLessThan(outcome.before[index]?.retained ?? 0);
      }
    }),
  );

  it.effect('stands over its grant rather than ending anything when there is nothing left to trim', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost((host) =>
        Effect.gen(function* () {
          const held = yield* terminal(host, 0);
          yield* grantLeaving(host, -CAP);
          const first = yield* host.reclaim.reclaim();
          const emptied = yield* standingOf(held);
          const again = yield* host.reclaim.reclaim();
          const fed = yield* Effect.result(held.interpretation.feed(bytes('still here')));
          return { first, emptied, again, alive: fed._tag };
        }),
      );

      expect(outcome.emptied.history).toBe(0);
      expect(outcome.first.standing.over).toBeGreaterThan(0);
      expect(outcome.again.trimmed).toEqual([]);
      expect(outcome.alive).toBe('Success');
    }),
  );

  it.effect('runs a pass on its own each time the ledger goes over, and wakes the viewers a trim moved', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost((host) =>
        Effect.gen(function* () {
          const held = yield* terminal(host, 0);
          const viewer = yield* held.presentation.openViewer();
          yield* held.presentation.grant(viewer, 1);
          const base = yield* held.presentation.next(viewer);
          yield* grantLeaving(host, -CAP);
          const before = yield* standingOf(held);
          yield* held.interpretation.feed(bytes(LINE));
          yield* host.reclaim.measure(held.execution);
          const woken = yield* held.presentation.await(viewer);
          const emptied = yield* standingOf(held);

          yield* held.presentation.grant(viewer, 1);
          yield* held.presentation.next(viewer);
          for (let line = 0; line < 6; line += 1) yield* held.interpretation.feed(bytes(LINE));
          const regrown = yield* standingOf(held);
          yield* host.reclaim.measure(held.execution);
          const wokenAgain = yield* held.presentation.await(viewer);
          const finished = yield* standingOf(held);
          return { base, before, woken, emptied, regrown, wokenAgain, finished };
        }),
      );

      expect(outcome.base?._tag).toBe('ScreenProgramFrame');
      expect(outcome.before.history).toBeGreaterThan(0);
      expect(outcome.woken).toBe(true);
      expect(outcome.emptied.history).toBe(0);
      expect(outcome.regrown.history).toBeGreaterThan(0);
      expect(outcome.wokenAgain).toBe(true);
      expect(outcome.finished.history).toBe(0);
    }),
  );
});
