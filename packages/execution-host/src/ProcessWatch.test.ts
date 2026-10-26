import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Duration, Effect, Schedule } from 'effect';
import { TestClock } from 'effect/testing';
import { Processes, ProcessesUnreadable, type ProcessReader, type ProcessRow } from './ProcessReader';
import { type ProcessWatch, makeProcessWatch } from './ProcessWatch';
import { FACTS_CHUNK, ROUND_BUDGET, makeProcessTables, makeProvenSet } from './ProvenSet';

const LEADER = 100;
const BIRTH = '500';
const TABLE: ReadonlyArray<ProcessRow> = [
  { pid: LEADER, parent: 1, work: LEADER, birth: '500', zombie: false },
  { pid: 101, parent: LEADER, work: LEADER, birth: '900', zombie: false },
];

const readerOver = (table: (call: number) => Effect.Effect<ReadonlyArray<ProcessRow>, ProcessesUnreadable>): ProcessReader => {
  let calls = 0;
  const read = Effect.suspend(() => table((calls += 1)));
  return {
    table: read,
    members: (work) => Effect.map(read, (rows) => rows.filter((row) => row.work === work)),
    facts: (pids) =>
      Effect.succeed({ processes: [], unread: pids.filter((pid) => pid !== 101).map((pid) => ({ pid, _tag: 'Gone' as const })) }),
    scan() {
      return this.table;
    },
    compareBirth: (left, right) => Number(left) - Number(right),
    bornBetween: () => false,
    identity: () => ({ _tag: 'Gone' }),
  };
};

const reach = (watch: ProcessWatch, rounds: number) =>
  watch.status.pipe(Effect.repeat({ until: (status) => status.rounds >= rounds, schedule: Schedule.spaced(0) }), Effect.asVoid);

it.effect('rounds never overlap, and a round that outlasts the period is counted delayed with the periods it covered skipped', () =>
  Effect.gen(function* () {
    let running = 0;
    let most = 0;
    const [status] = yield* Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const reader = readerOver((call) =>
          Effect.gen(function* () {
            running += 1;
            most = Math.max(most, running);
            if (call === 2) {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(gate);
            }
            running -= 1;
            return TABLE;
          }),
        );
        const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, reader));
        const set = yield* makeProvenSet({ tables, leader: LEADER, birth: BIRTH, work: LEADER });
        const watch = yield* makeProcessWatch({ tables });
        yield* watch.hold(set);
        yield* reach(watch, 1);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Deferred.await(entered);
        yield* TestClock.adjust(Duration.millis(2_500));
        yield* Deferred.succeed(gate, undefined);
        yield* reach(watch, 3);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* reach(watch, 4);
        return [yield* watch.status] as const;
      }),
    );
    expect(most).toBe(1);
    expect(status.rounds).toBe(4);
    expect(status.delayed).toBe(1);
    expect(status.skipped).toBe(1);
    expect(status.longestRoundMs).toBe(2_500);
  }),
);

it.effect('a round whose table cannot be read is counted failed and leaves every set as it stood', () =>
  Effect.gen(function* () {
    const reader = readerOver((call) => (call === 1 ? Effect.succeed(TABLE) : Effect.fail(new ProcessesUnreadable({ detail: 'refused' }))));
    const [status, reading] = yield* Effect.scoped(
      Effect.gen(function* () {
        const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, reader));
        const set = yield* makeProvenSet({ tables, leader: LEADER, birth: BIRTH, work: LEADER });
        const watch = yield* makeProcessWatch({ tables });
        yield* watch.hold(set);
        yield* reach(watch, 1);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* reach(watch, 2);
        return [yield* watch.status, yield* set.reading] as const;
      }),
    );
    expect(reading.members).toBe(1);
    expect(reading.failures).toBe(1);
    expect(status.rounds).toBe(2);
    expect(status.failed).toBe(1);
  }),
);

it.effect('one round reads the fields of at most its budget of members across every set, in chunks, oldest first', () =>
  Effect.gen(function* () {
    const leaders = [100, 200];
    const width = Math.floor(ROUND_BUDGET / 2) + 1;
    const table: ProcessRow[] = leaders.flatMap((leader) => [
      { pid: leader, parent: 1, work: leader, birth: '500', zombie: false },
      ...Array.from({ length: width }, (_, index) => ({
        pid: leader * 100_000 + index,
        parent: leader,
        work: leader,
        birth: '900',
        zombie: false,
      })),
    ]);
    const calls: number[][] = [];
    const reader: ProcessReader = {
      table: Effect.sync(() => table),
      members: (work) => Effect.sync(() => table.filter((row) => row.work === work)),
      facts: (pids) =>
        Effect.sync(() => {
          calls.push([...pids]);
          return {
            processes: pids.map((pid) => ({
              pid,
              parent: 1,
              work: 1,
              birth: '900',
              args: { _tag: 'Read' as const, value: ['sleep'] },
              executable: { _tag: 'Unreadable' as const, detail: 'denied' },
              folder: { _tag: 'Unreadable' as const, detail: 'denied' },
            })),
            unread: [],
          };
        }),
      scan() {
        return this.table;
      },
      compareBirth: (left, right) => Number(left) - Number(right),
      bornBetween: () => false,
      identity: () => ({ _tag: 'Gone' }),
    };
    const [first, second, unread] = yield* Effect.scoped(
      Effect.gen(function* () {
        const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, reader));
        const sets = yield* Effect.forEach(leaders, (leader) => makeProvenSet({ tables, leader, birth: BIRTH, work: leader }));
        const watch = yield* makeProcessWatch({ tables });
        for (const set of sets) yield* watch.hold(set);
        yield* reach(watch, 1);
        const first = calls.splice(0);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* reach(watch, 2);
        const second = calls.splice(0);
        const members = (yield* Effect.forEach(sets, (set) => set.members)).flat();
        return [first, second, members.filter((member) => member.facts === undefined).length] as const;
      }),
    );
    expect(first.every((pids) => pids.length <= FACTS_CHUNK)).toBe(true);
    expect(first.flat().length).toBe(ROUND_BUDGET);
    expect(second.flat().length).toBe(ROUND_BUDGET);
    const refreshed = new Set(first.flat());
    expect(second.flat().filter((pid) => !refreshed.has(pid)).length).toBe(width * 2 - ROUND_BUDGET);
    expect(unread).toBe(0);
  }),
);
