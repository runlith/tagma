import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { ProcessReader } from './ProcessReader';
import { Spending } from './processSpending';
import type { ProcessCounters } from './UsageReader';

const reader: ProcessReader = {
  table: Effect.succeed([]),
  members: () => Effect.succeed([]),
  facts: () => Effect.succeed({ processes: [], unread: [] }),
  identity: () => ({ _tag: 'Gone' }),
  scan() {
    return this.table;
  },
  compareBirth: (left, right) => Number(left) - Number(right),
  bornBetween: (birth, from, until) => Number(birth) > from && Number(birth) <= until,
  resolve: () => 'unknown',
};

const SECOND = 1_000_000;

const row = (pid: number, parent: number, micros: number | undefined, birth = 10): ProcessCounters => ({
  pid,
  birth: String(birth),
  parent,
  work: 0,
  zombie: false,
  cpu: micros === undefined ? undefined : { micros, reapedMicros: 0 },
  gpu: { _tag: 'Unavailable', reason: 'not measured' },
  residentBytes: 1,
  footprintBytes: 1,
  signal: true,
  name: `p${pid}`,
  program: { key: `p${pid}`, name: `p${pid}` },
});

const steps = (readings: ReadonlyArray<ReadonlyArray<ProcessCounters>>) => {
  const spending = new Spending(reader);
  return readings.map((rows, at) => spending.next(rows, 1_000 * (at + 1), SECOND * (at + 1)).cores);
};

test('a child born and reaped between two readings is charged through its parent', () => {
  const [, second] = steps([[row(10, 1, 100)], [row(10, 1, 100 + 600_000)]]);
  expect(second!.get(10)).toBeCloseTo(0.6, 6);
});

test('a child read once and reaped before the next reading charges only its last fragment', () => {
  const [, second] = steps([
    [row(10, 1, 100), row(11, 10, 300_000)],
    [row(10, 1, 100 + 350_000), row(12, 10, 50_000, 1_500)],
  ]);
  expect(second!.get(10)).toBeCloseTo(0.05, 6);
  expect(second!.get(12)).toBeCloseTo(0.05, 6);
});

test('a parent and its child reaped in the same interval charge the reaper only their last fragments', () => {
  const [, second] = steps([
    [row(10, 1, 0), row(11, 10, 2 * SECOND), row(12, 11, 30 * SECOND)],
    [row(10, 1, 2 * SECOND + 30 * SECOND + 400_000)],
  ]);
  expect(second!.get(10)).toBeCloseTo(0.4, 6);
});

test('a command reaped by the holder between two readings is charged to its execution, not to the holder', () => {
  const spending = new Spending(reader);
  const leader = { pid: 20, birth: '1500' };
  spending.next([row(5, 1, 0)], 1_000, SECOND, [], 5);
  const holder = { ...row(5, 1, 700_000 + 10_000), cpu: { micros: 710_000, reapedMicros: 700_000 } };
  const second = spending.next([holder], 2_000, 2 * SECOND, [{ key: 'e', leader, cpuMicros: 700_000 }], 5);
  expect(second.reaped.get('e')).toBeCloseTo(0.7, 6);
  expect(second.cores.get(5)).toBeCloseTo(0.01, 6);
});

const counted = (pid: number, parent: number, own: number | undefined, reapedMicros?: number): ProcessCounters => ({
  ...row(pid, parent, own === undefined ? undefined : own + (reapedMicros ?? 0)),
  cpu: own === undefined ? undefined : { micros: own + (reapedMicros ?? 0), reapedMicros },
});

const spentOf = (readings: ReadonlyArray<ReadonlyArray<ProcessCounters>>) => {
  const spending = new Spending(reader);
  return readings.map((rows, at) => spending.next(rows, 1_000 * (at + 1), SECOND * (at + 1)));
};

test('a counter read once without its reaped children compares only own time, never the children total it lacks', () => {
  const [, ps, back] = spentOf([
    [counted(10, 1, SECOND, 10 * SECOND)],
    [counted(10, 1, 1.1 * SECOND)],
    [counted(10, 1, 1.2 * SECOND, 10 * SECOND)],
  ]);
  expect(ps!.cores.get(10)).toBeCloseTo(0.1, 6);
  expect(back!.cores.get(10)).toBeCloseTo(0.1, 6);
  expect([ps!.fromChildren.has(10), back!.fromChildren.has(10)]).toEqual([false, false]);
});

test('a process that stood before the first reading charges nothing of its history', () => {
  const [, second] = steps([[row(10, 1, 100)], [row(10, 1, 100), row(20, 1, 9 * SECOND, 5)]]);
  expect(second!.get(20)).toBeUndefined();
});
