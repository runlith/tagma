import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { EvidenceScope, LoadGroup } from '@runlith/executions/protocol/evidence';
import { makeProcessUsage } from './ProcessUsage';
import { Processes, type ProcessReader } from './ProcessReader';
import type { ProcessCounters, UsageRead, UsageReader } from './UsageReader';
import type { EndedExecution, ObservedExecution } from './ProcessEvidence';

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
  resolve: (part) => ({ pid: part.pid, birth: String(part.pid) }),
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
  gpu: { _tag: 'Unavailable', reason: 'not measured' },
  memoryKind: 'footprint',
  residentBytes: 1_000,
  footprintBytes: 1_000,
  signal: true,
  name: program,
  program: { key: program, name: program },
});

const readings = (steps: ReadonlyArray<UsageRead>): Effect.Effect<UsageReader> =>
  Effect.map(Ref.make(0), (taken) => ({
    machineName: 'Computer',
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
      native: yield* readings(
        [before, after].map((read, index) => ({
          ...read,
          processes: read.processes.map((one) =>
            one.pid === 60 ? { ...one, gpu: { _tag: 'Measured' as const, micros: index * 200_000 } } : one,
          ),
        })),
      ),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1,
    }).pipe(Effect.provideService(Processes, reader));
    yield* usage.subscribe('fixture', 50, [{ key: 'part', pid: 300, createdMs: 1, precisionMs: 1 }]);
    yield* usage.sample();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* usage.sample();
    const groups = (yield* usage.load)?.groups ?? [];
    const own = (group: LoadGroup) =>
      group.owner._tag === 'Installation' || group.owner._tag === 'Execution' || group.owner._tag === 'Part';
    expect(groups.filter(own).reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(1.7, 6);
    const role = (name: string) => groups.find((group) => group.owner._tag === 'Installation' && group.owner.role === name);
    expect(role('server')?.cores).toBeCloseTo(0.2, 6);
    expect(role('host')?.cores).toBeCloseTo(0.1, 6);
    expect(role('host')).toMatchObject({ gpuCores: 0.2, gpuMeasured: 1, processes: [] });
    expect(role('overflow')?.cores).toBeCloseTo(1.4, 6);
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
        native: yield* readings(
          [before, after].map((read) => ({
            ...read,
            processes: read.processes.map((one) => (one.pid === 100 ? { ...one, memoryKind: 'pss' as const } : one)),
          })),
        ),
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
    const installation = groups.filter((group) => group.owner._tag === 'Installation');
    expect(installation.flatMap((group) => group.processes.map((one) => one.identity.pid)).toSorted()).toEqual([50, 60]);
    expect(installation.every((group) => group.processes.every((one) => !one.signal))).toBe(true);
    expect(byOwner('Program', 'Google Chrome')?.cores).toBeCloseTo(0.8, 6);
    expect(byOwner('Program', 'yes')?.cores).toBeCloseTo(0.4, 6);
    expect(byOwner('Kernel')?.cores).toBeCloseTo(0.5, 6);
    expect(groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(3, 6);
    expect(new Set(groups.flatMap((group) => group.processes.map((one) => one.identity.pid))).size).toBe(6);
    expect(result.latest?.cpu).toMatchObject({ _tag: 'Measured', cores: expect.closeTo(1, 6) });
    expect(result.latest?.footprint).toMatchObject({ _tag: 'Measured', kind: 'pss', bytes: 1_000 });
  }),
);

it.effect("Tagma's processes carry their role, and the server's own CPU stands apart from the children it reaped, counted once", () =>
  Effect.gen(function* () {
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(undefined), watching: Effect.succeed([]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([
        {
          ...before,
          processes: [
            row(50, 1, 0, 'bun'),
            row(51, 50, 0.3 * SECOND, 'git'),
            row(60, 1, 0, 'bun'),
            { ...row(61, 1, 0, 'service'), onBehalfOf: 60 },
          ],
        },
        {
          ...after,
          machine: { busy: 120, total: 400, cores: 4, memory },
          processes: [
            row(50, 1, 1.2 * SECOND, 'bun', SECOND),
            row(60, 1, 0.1 * SECOND, 'bun'),
            { ...row(61, 1, 0.2 * SECOND, 'service'), onBehalfOf: 60 },
          ],
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
    const groups = (yield* usage.load)?.groups ?? [];
    const role = (name: string) => groups.find((group) => group.owner._tag === 'Installation' && group.owner.role === name);
    expect(role('server')?.processes.find((one) => one.identity.pid === 50)).toMatchObject({
      role: 'server',
      cores: expect.closeTo(0.9, 6),
      reapedCores: expect.closeTo(0.7, 6),
    });
    expect(role('host')?.processes.find((one) => one.identity.pid === 60)).toMatchObject({
      role: 'host',
      cores: expect.closeTo(0.1, 6),
      reapedCores: 0,
    });
    expect(
      role('host')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([60, 61]);
    expect(role('server')?.cores).toBeCloseTo(0.9, 6);
    expect(role('host')?.cores).toBeCloseTo(0.3, 6);
  }),
);

it.effect('declared parts and processes working on their behalf are placed by resolved identity and replaced live', () =>
  Effect.gen(function* () {
    const process = (pid: number, parent: number, extra: Partial<ProcessCounters> = {}) => ({
      ...row(pid, parent, 0, `p${pid}`),
      ...extra,
    });
    const snapshot: UsageRead = {
      ...before,
      processes: [
        process(10, 1),
        process(11, 10, { gpu: { _tag: 'Measured', micros: 100_000 } }),
        process(12, 11),
        process(50, 1),
        process(51, 50),
        process(60, 1),
        process(90, 50, { onBehalfOf: 11 }),
        process(91, 90),
        process(92, 1, { onBehalfOf: 11 }),
        process(93, 10, { onBehalfOf: 11 }),
        process(94, 93),
        process(95, 10, { onBehalfOf: 12 }),
        process(100, 11),
        process(101, 100),
        process(200, 1),
      ],
    };
    const next: UsageRead = {
      ...snapshot,
      observedAt: 2_000,
      takenAtMicros: SECOND,
      processes: snapshot.processes.map((one) => (one.pid === 11 ? { ...one, gpu: { _tag: 'Measured', micros: 400_000 } } : one)),
    };
    const parts = [
      { key: 'window', pid: 10, createdMs: 1, precisionMs: 1 },
      { key: 'renderer', pid: 11, createdMs: 1, precisionMs: 1 },
      { key: 'execution-child', pid: 101, createdMs: 1, precisionMs: 1 },
      { key: 'reused', pid: 200, createdMs: 1, precisionMs: 1 },
      { key: 'unreadable', pid: 300, createdMs: 1, precisionMs: 1 },
    ];
    const resolved: ProcessReader = {
      ...reader,
      resolve: (part) =>
        part.key === 'reused' ? 'different' : part.key === 'unreadable' ? 'unknown' : { pid: part.pid, birth: String(part.pid) },
    };
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([snapshot, next]),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1_000_000,
    }).pipe(Effect.provideService(Processes, resolved));
    yield* usage.subscribe('fixture', 50, parts);
    yield* usage.sample();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* usage.sample();
    const first = yield* usage.load;
    const owned = (key: string) => first?.groups.find((group) => group.owner._tag === 'Part' && group.owner.key === key);
    expect(owned('window')?.processes.map((one) => one.identity.pid)).toEqual([10]);
    expect(
      owned('renderer')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([11, 12, 90, 91, 92, 93, 94, 95]);
    expect(owned('renderer')?.gpuCores).toBeCloseTo(0.3, 6);
    expect(owned('renderer')?.gpuUnread).toBe(7);
    expect(owned('renderer')?.processes.find((one) => one.identity.pid === 11)?.gpu).toEqual({ _tag: 'Measured', cores: 0.3 });
    expect(owned('renderer')?.processes.find((one) => one.identity.pid === 90)?.gpu).toEqual({
      _tag: 'Unavailable',
      reason: 'not measured',
    });
    expect(
      first?.groups
        .find((group) => group.owner._tag === 'Execution')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([100, 101]);
    expect(
      first?.groups
        .filter((group) => group.owner._tag === 'Installation')
        .flatMap((group) => group.processes.map((one) => one.identity.pid))
        .toSorted(),
    ).toEqual([50, 51, 60]);
    expect(first?.unresolvedParts.map(({ part, reason }) => [part.key, reason])).toEqual([
      ['reused', 'different'],
      ['unreadable', 'unknown'],
    ]);
    yield* usage.parts('fixture', [...parts].reverse());
    yield* usage.sample();
    const reordered = yield* usage.load;
    expect(
      reordered?.groups
        .find((group) => group.owner._tag === 'Part' && group.owner.key === 'renderer')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([11, 12, 90, 91, 92, 93, 94, 95]);
    yield* usage.parts('fixture', [parts[1]!]);
    yield* usage.sample();
    const replacement = yield* usage.load;
    expect(replacement?.groups.some((group) => group.owner._tag === 'Part' && group.owner.key === 'window')).toBe(false);
    expect(replacement?.unresolvedParts).toEqual([]);
  }),
);

it.effect('a completed execution uses its container counter or marks the process sum as a lower bound', () =>
  Effect.gen(function* () {
    const ended: EndedExecution = { ref, leader: { pid: 100, birth: '1500' }, cpuMicros: 600_000 };
    const noChildren = (micros: number): ProcessCounters => ({ ...row(60, 1, micros, 'host'), cpu: { micros, reapedMicros: undefined } });
    const initial: UsageRead = {
      ...before,
      processes: [noChildren(0)],
      machine: { busy: 0, total: 0, cores: 4, memory },
    };
    const final: UsageRead = {
      ...after,
      processes: [noChildren(100_000)],
      machine: { busy: 100, total: 400, cores: 4, memory },
    };
    const resolved: ProcessReader = { ...reader, bornBetween: (birth, from, until) => Number(birth) > from && Number(birth) <= until };
    const scenario = Effect.fnUntraced(function* (container: boolean) {
      const endings = yield* Ref.make<ReadonlyArray<EndedExecution>>([]);
      const usage = yield* makeProcessUsage({
        topology: { of: () => Effect.succeed(undefined), watching: Effect.succeed([]), ended: Ref.get(endings) },
        scope,
        policy: { periodMs: 100 },
        native: yield* readings([initial, { ...final, containers: container ? [{ execution: ref, cpuMicros: 600_000 }] : undefined }]),
        hostPid: 60,
        cores: 4,
        budgetBytes: 1_000_000,
      }).pipe(Effect.provideService(Processes, resolved));
      yield* usage.subscribe('fixture', 50, []);
      yield* usage.sample();
      yield* Ref.set(endings, [ended]);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* usage.sample();
      return yield* usage.load;
    });
    const measured = yield* scenario(true);
    const lower = yield* scenario(false);
    const execution = (reading: typeof measured) => reading?.groups.find((group) => group.owner._tag === 'Execution');
    expect(execution(measured)?.cores).toBeCloseTo(0.6, 6);
    expect(execution(measured)?.lowerBound).toBeUndefined();
    expect(measured?.groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(1, 6);
    expect(execution(lower)).toMatchObject({ cores: 0, lowerBound: true });
    expect(lower?.groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(1, 6);
  }),
);

it.effect('a container stays attributed when its leader leaves after the execution census', () =>
  Effect.gen(function* () {
    const initial: UsageRead = {
      ...before,
      processes: [row(60, 1, 0, 'host'), row(100, 1, 100_000, 'command')],
      containers: [{ execution: ref, cpuMicros: 100_000 }],
      machine: { busy: 0, total: 0, cores: 4, memory },
    };
    const final: UsageRead = {
      ...after,
      processes: [row(60, 1, 100_000, 'host')],
      containers: [{ execution: ref, cpuMicros: 700_000 }],
      machine: { busy: 100, total: 400, cores: 4, memory },
    };
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([initial, final]),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1_000_000,
    }).pipe(Effect.provideService(Processes, reader));
    yield* usage.subscribe('fixture', 50, []);
    yield* usage.sample();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* usage.sample();
    const reading = yield* usage.load;
    const execution = reading?.groups.find((group) => group.owner._tag === 'Execution');
    expect(execution?.owner).toMatchObject({ _tag: 'Execution', ended: false });
    expect(execution?.cores).toBeCloseTo(0.6, 6);
    expect(reading?.groups.reduce((sum, group) => sum + group.cores, 0)).toBeCloseTo(1, 6);
  }),
);

it.effect('an on-behalf-of service does not replace an execution current child', () =>
  Effect.gen(function* () {
    const usage = yield* makeProcessUsage({
      topology: { of: () => Effect.succeed(observed), watching: Effect.succeed([observed]) },
      scope,
      policy: { periodMs: 100 },
      native: yield* readings([
        {
          ...before,
          processes: [row(100, 1, 0, 'command'), row(101, 100, 0, 'child'), { ...row(110, 1, 0, 'service'), onBehalfOf: 100 }],
        },
      ]),
      hostPid: 60,
      cores: 4,
      budgetBytes: 1_000_000,
    }).pipe(Effect.provideService(Processes, reader));
    yield* usage.subscribe('fixture', 50, []);
    yield* usage.sample();
    expect((yield* usage.latest(ref.execution))?.current).toEqual({ pid: 101, birth: '101' });
    expect(
      (yield* usage.load)?.groups
        .find((group) => group.owner._tag === 'Execution')
        ?.processes.map((one) => one.identity.pid)
        .toSorted(),
    ).toEqual([100, 101, 110]);
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
