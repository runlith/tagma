import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { EvidenceScope, LoadGroup } from '@runlith/executions/protocol/evidence';
import { makeProcessUsage } from './ProcessUsage';
import { Processes, type ProcessReader } from './ProcessReader';
import type { ProcessCounters, UsageRead, UsageReader } from './UsageReader';
import type { ObservedExecution } from './ProcessEvidence';

const machine = { _tag: 'Local', machine: 'usage-fixture' } as const;
const scope: EvidenceScope = { host: machine, network: machine };
const ref = {
  installation: Schema.decodeUnknownSync(InstallationId)('installation-1'),
  execution: Schema.decodeUnknownSync(ExecutionId)('command-1'),
  incarnation: 1,
};
const reader: ProcessReader = {
  table: Effect.succeed([]),
  members: () => Effect.succeed([]),
  facts: () => Effect.succeed({ processes: [], unread: [] }),
  identity: () => ({ _tag: 'Gone' }),
  scan() {
    return this.table;
  },
  compareBirth: (left, right) => Number(left) - Number(right),
  bornBetween: () => false,
};

const row = (pid: number, parent: number, micros: number, program: string, reapedMicros = 0): ProcessCounters => ({
  pid,
  birth: String(pid),
  parent,
  work: 0,
  zombie: false,
  cpu: { micros, reapedMicros },
  residentBytes: 1_000,
  footprintBytes: 1_000,
  signal: true,
  name: program,
  program: { key: program, name: program },
});

const readings = (steps: ReadonlyArray<UsageRead>): Effect.Effect<UsageReader> =>
  Effect.map(Ref.make(0), (taken) => ({
    read: () =>
      Effect.map(
        Ref.getAndUpdate(taken, (at) => at + 1),
        (at) => steps[Math.min(at, steps.length - 1)]!,
      ),
  }));

const memory = { _tag: 'Unknown', reason: 'unknown', detail: 'fixture' } as const;
const SECOND = 1_000_000;

const before: UsageRead = {
  observedAt: 1_000,
  takenAtMicros: 0,
  machine: { busy: 0, total: 0, cores: 4, memory },
  processes: [
    row(50, 1, 0, 'bun'),
    row(60, 1, 0, 'bun'),
    row(100, 1, 0, 'sh'),
    row(101, 100, 2 * SECOND, 'svelte-check'),
    row(200, 1, 0, 'Google Chrome'),
    row(201, 200, 0, 'Google Chrome'),
    row(300, 1, 0, 'yes'),
  ],
};
const after: UsageRead = {
  observedAt: 2_000,
  takenAtMicros: SECOND,
  machine: { busy: 300, total: 400, cores: 4, memory },
  processes: [
    row(50, 1, 0.2 * SECOND, 'bun'),
    row(60, 1, 0.1 * SECOND, 'bun'),
    row(100, 1, 3 * SECOND, 'sh'),
    row(200, 1, 0.5 * SECOND, 'Google Chrome'),
    row(201, 200, 0.3 * SECOND, 'Google Chrome'),
    row(300, 1, 0.4 * SECOND, 'yes'),
  ],
};
const observed: ObservedExecution = { ref, scope, leader: { pid: 100, birth: '100' } };

it.effect("a reading too large for its envelope keeps Tagma's own CPU on Tagma's side and spills the rest into other programs", () =>
  Effect.gen(function* () {
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([before, after]),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1,
    }).pipe(Effect.provideService(Processes, reader));
    yield* usage.subscribe('fixture', 50, []);
    yield* usage.sample();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* usage.sample();
    const groups = (yield* usage.load)?.groups ?? [];
    const own = (group: LoadGroup) => group.owner._tag === 'Installation' || group.owner._tag === 'Execution';
    expect(groups.filter(own).reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(1.3, 6);
    expect(groups.filter((group) => !own(group)).map((group) => group.owner)).toEqual([
      { _tag: 'Program', key: 'overflow', name: 'Other programs' },
    ]);
    expect(groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(3, 6);
  }),
);

it.effect('every process is charged to one row, a reaped child to its execution, and the rows add up to the machine', () =>
  Effect.gen(function* () {
    const result = yield* Effect.gen(function* () {
      const usage = yield* makeProcessUsage({
        topology: { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) },
        scope,
        policy: { periodMs: 100 },
        native: yield* readings([before, after]),
        hostPid: 60,
        cores: 4,
        budgetBytes: 1_000_000,
      }).pipe(Effect.provideService(Processes, reader));
      yield* usage.subscribe('fixture', 50, []);
      yield* usage.sample();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* usage.sample();
      return { load: yield* usage.load, latest: yield* usage.latest(ref.execution) };
    });
    const groups = result.load?.groups ?? [];
    const byOwner = (owner: LoadGroup['owner']['_tag'], name?: string): LoadGroup | undefined =>
      groups.find(
        (group) => group.owner._tag === owner && (name === undefined || (group.owner._tag === 'Program' && group.owner.name === name)),
      );
    expect(result.load?.cpu).toBeCloseTo(3, 6);
    expect(byOwner('Execution')?.cores).toBeCloseTo(1, 6);
    expect(byOwner('Execution')?.processes.map((one) => one.identity.pid)).toEqual([100]);
    expect(
      byOwner('Installation')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([50, 60]);
    expect(byOwner('Installation')?.processes.every((one) => !one.signal)).toBe(true);
    expect(byOwner('Program', 'Google Chrome')?.cores).toBeCloseTo(0.8, 6);
    expect(byOwner('Program', 'yes')?.cores).toBeCloseTo(0.4, 6);
    expect(byOwner('Kernel')?.cores).toBeCloseTo(0.5, 6);
    expect(groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(3, 6);
    expect(new Set(groups.flatMap((group) => group.processes.map((one) => one.identity.pid))).size).toBe(6);
    expect(result.latest?.cpu).toMatchObject({ _tag: 'Measured', cores: expect.closeTo(1, 6) });
  }),
);

it.effect("Tagma's processes carry their role, and the server's own CPU stands apart from the children it reaped, counted once", () =>
  Effect.gen(function* () {
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(undefined), watching: Effect.succeed([]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([
        { ...before, processes: [row(50, 1, 0, 'bun'), row(51, 50, 0.3 * SECOND, 'git'), row(60, 1, 0, 'bun')] },
        {
          ...after,
          machine: { busy: 100, total: 400, cores: 4, memory },
          processes: [row(50, 1, 1.2 * SECOND, 'bun', SECOND), row(60, 1, 0.1 * SECOND, 'bun')],
        },
      ]),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1_000_000,
    }).pipe(Effect.provideService(Processes, reader));
    yield* usage.subscribe('fixture', 50, []);
    yield* usage.sample();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* usage.sample();
    const installation = (yield* usage.load)?.groups.find((group) => group.owner._tag === 'Installation');
    const of = (pid: number) => installation?.processes.find((one) => one.identity.pid === pid);
    expect(of(50)).toMatchObject({ role: 'server', cores: expect.closeTo(0.9, 6), reapedCores: expect.closeTo(0.7, 6) });
    expect(of(60)).toMatchObject({ role: 'host', cores: expect.closeTo(0.1, 6), reapedCores: 0 });
    expect(installation?.cores).toBeCloseTo(1, 6);
  }),
);

it.effect('fits escaped command text inside its encoded load envelope without losing scalar usage', () =>
  Effect.gen(function* () {
    const snapshot: UsageRead = {
      ...before,
      processes: Array.from({ length: 7 }, (_, index) => ({ ...row(1000 + index, 1, 0, 'worker'), command: '\u0001'.repeat(240) })),
    };
    const readWithBudget = Effect.fnUntraced(function* (budgetBytes: number) {
      const usage = yield* makeProcessUsage({
        topology: { of: () => Effect.succeed(undefined), watching: Effect.succeed([]) },
        scope,
        policy: { periodMs: 100 },
        native: yield* readings([snapshot]),
        hostPid: 60,
        cores: 4,
        budgetBytes,
      }).pipe(Effect.provideService(Processes, reader));
      yield* usage.subscribe('fixture', 50, []);
      yield* usage.refresh();
      const load = yield* usage.load;
      if (load === undefined) return yield* Effect.die(new Error('the usage reader returned no frame'));
      return load;
    });
    const full = yield* readWithBudget(1_000_000);
    const encodedBytes = (load: typeof full) => new TextEncoder().encode(JSON.stringify(load)).byteLength;
    const budget = encodedBytes(full) - 1;
    const bounded = yield* readWithBudget(budget);
    expect(encodedBytes(bounded)).toBeLessThanOrEqual(budget);
    expect(bounded.groups.reduce((sum, group) => sum + group.memoryBytes, 0)).toBe(
      full.groups.reduce((sum, group) => sum + group.memoryBytes, 0),
    );
  }),
);
