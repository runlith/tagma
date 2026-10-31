import { Data, Clock, Deferred, Effect, Ref, Semaphore, type Scope } from 'effect';
import type { NativeRelation, UsagePolicy } from '@runlith/executions/protocol/capacity';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import {
  identityMatch,
  sameScope,
  type DeclaredPart,
  type EvidenceScope,
  type InstallationRole,
  type LoadInterest,
  type LoadGroup,
  type LoadReading,
  type ProcessUsageRow,
  type ProcessWitness,
  type UsageReading,
} from '@runlith/executions/protocol/evidence';
import { grouped, place } from './ProcessAccount';
import type { ExecutionTopology, ObservedExecution } from './ProcessEvidence';
import { Processes } from './ProcessReader';
import { ProcessTree } from './processTree';
import { Spending, type Spent } from './processSpending';
import type { MachineCounters, ProcessCounters, UsageReader, UsageRead, UsageUnavailable } from './UsageReader';
import { makeLoadRecorder, usageStep } from './usageTelemetry';

const OWN = { adapter: 'process-usage', probe: 'native' } as const;
const COVERAGE: ReadonlyArray<NativeRelation> = ['leader', 'ancestry', 'work'];
const IDLE_PERIODS = 5;
const UNREAD_MEMORY = { _tag: 'Unknown', reason: 'failed', detail: 'the machine memory was not read' } as const;

export class UsageUnreadable extends Data.TaggedError('UsageUnreadable')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

type Subscriber = { readonly serverPid: number; readonly parts: ReadonlyArray<DeclaredPart>; readonly interest: LoadInterest };
type MachineSample = { readonly counters: MachineCounters; readonly takenAtMicros: number };

export type ProcessUsage = {
  readonly scope: EvidenceScope;
  readonly latest: (execution: ExecutionId) => Effect.Effect<UsageReading | undefined>;
  readonly all: () => Effect.Effect<ReadonlyArray<UsageReading>>;
  readonly sampled: () => Effect.Effect<void>;
  readonly load: Effect.Effect<LoadReading | undefined>;
  readonly subscribe: (key: string, serverPid: number, parts: ReadonlyArray<DeclaredPart>) => Effect.Effect<void, never, Scope.Scope>;
  readonly interest: (key: string, interest: LoadInterest) => Effect.Effect<void>;
  readonly parts: (key: string, parts: ReadonlyArray<DeclaredPart>) => Effect.Effect<void>;
  readonly sample: () => Effect.Effect<void>;
  readonly refresh: () => Effect.Effect<void>;
  readonly sampling: Effect.Effect<never>;
};

export type UsageInput = {
  readonly topology: ExecutionTopology;
  readonly scope: EvidenceScope;
  readonly policy: UsagePolicy;
  readonly native: UsageReader;
  readonly hostPid: number;
  readonly cores: number;
  readonly budgetBytes: number;
  readonly holderPid?: number;
};

type MachineReading = {
  readonly cores: number;
  readonly cpu: number | null;
  readonly memory: LoadReading['memory'];
  readonly unread?: string;
};

export const makeProcessUsage = Effect.fnUntraced(function* ({
  topology,
  scope,
  policy,
  native: counterSource,
  hostPid,
  cores,
  budgetBytes,
  holderPid = 0,
}: UsageInput) {
  const reader = yield* Processes;
  if (policy.periodMs < 1) return yield* new UsageUnreadable({ detail: 'periodMs must be at least one millisecond' });
  const holder = holderPid > 0 ? reader.identity(holderPid) : undefined;
  const heldRef = yield* Ref.make<ReadonlyMap<ExecutionId, UsageReading>>(new Map());
  const rounds = yield* Semaphore.make(1);
  const wakeRef = yield* Ref.make(Deferred.makeUnsafe<void>());
  const subscribersRef = yield* Ref.make<ReadonlyMap<string, Subscriber>>(new Map());
  const changedRef = yield* Ref.make(Deferred.makeUnsafe<void>());
  const frame = yield* Ref.make<LoadReading | undefined>(undefined);
  const recorder = yield* makeLoadRecorder;
  const spending = new Spending(reader);
  let machineSample: MachineSample | undefined;
  let revisionValue = 0;

  function latest(execution: ExecutionId): Effect.Effect<UsageReading | undefined> {
    return Effect.map(Ref.get(heldRef), (held) => held.get(execution));
  }

  function all(): Effect.Effect<ReadonlyArray<UsageReading>> {
    return Effect.map(Ref.get(heldRef), (held) => [...held.values()]);
  }

  function sampled(): Effect.Effect<void> {
    return Effect.flatMap(Ref.get(wakeRef), Deferred.await);
  }

  function subscribe(key: string, serverPid: number, parts: ReadonlyArray<DeclaredPart>) {
    return Effect.acquireRelease(
      Effect.andThen(
        Ref.update(subscribersRef, (held) => new Map(held).set(key, { serverPid, parts, interest: { interested: false, others: false } })),
        notify(),
      ),
      () =>
        Effect.andThen(
          Ref.update(subscribersRef, (held) => {
            const next = new Map(held);
            next.delete(key);
            return next;
          }),
          notify(),
        ),
    );
  }

  function interest(key: string, interest: LoadInterest): Effect.Effect<void> {
    return Effect.andThen(
      Ref.update(subscribersRef, (held) => {
        const standing = held.get(key);
        return standing === undefined ? held : new Map(held).set(key, { ...standing, interest });
      }),
      notify(),
    );
  }

  function parts(key: string, parts: ReadonlyArray<DeclaredPart>): Effect.Effect<void> {
    return Effect.andThen(
      Ref.update(subscribersRef, (held) => {
        const standing = held.get(key);
        return standing === undefined ? held : new Map(held).set(key, { ...standing, parts });
      }),
      notify(),
    );
  }

  function notify(): Effect.Effect<void> {
    return Effect.flatMap(Ref.getAndSet(changedRef, Deferred.makeUnsafe<void>()), (wake) =>
      Effect.asVoid(Deferred.succeed(wake, undefined)),
    );
  }

  function sample(): Effect.Effect<void> {
    return Effect.asVoid(Semaphore.withPermitsIfAvailable(rounds, 1)(usageStep(round())));
  }

  function refresh(): Effect.Effect<void> {
    return Semaphore.withPermits(rounds, 1)(usageStep(round()));
  }

  function readSampling(): Effect.Effect<never> {
    return Effect.forever(
      Effect.gen(function* () {
        const changed = yield* Ref.get(changedRef);
        const subscribers = yield* Ref.get(subscribersRef);
        if (subscribers.size === 0) {
          yield* Ref.set(heldRef, new Map());
          yield* Ref.set(frame, undefined);
          machineSample = undefined;
          spending.reset();
          recorder.reset();
          return yield* Deferred.await(changed);
        }
        const period =
          policy.periodMs * ([...subscribers.values()].some((subscriber) => subscriber.interest.interested) ? 1 : IDLE_PERIODS);
        const remaining = yield* untilDue(period);
        if (remaining > 0) return yield* Effect.raceFirst(Effect.sleep(remaining), Deferred.await(changed));
        yield* Semaphore.withPermits(rounds, 1)(Effect.flatMap(untilDue(period), (left) => (left > 0 ? Effect.void : usageStep(round()))));
      }),
    );
  }

  const untilDue = Effect.fnUntraced(function* (period: number) {
    const before = yield* Ref.get(frame);
    if (before === undefined) return 0;
    return period - ((yield* monotonicMicros) - before.takenAtMicros) / 1000;
  });

  const round = Effect.fnUntraced(function* () {
    const watching = (yield* topology.watching).filter((row) => sameScope(row.scope, scope));
    const residuals = topology.residuals === undefined ? [] : yield* topology.residuals;
    const ended = topology.ended === undefined ? [] : yield* topology.ended;
    const subscribers = yield* Ref.get(subscribersRef);
    yield* Effect.matchEffect(counterSource.read(), {
      onFailure: Effect.fnUntraced(function* (failure: UsageUnavailable) {
        const takenAtMicros = yield* monotonicMicros;
        const revision = (revisionValue += 1);
        yield* Ref.set(frame, {
          scope,
          observedAt: yield* Clock.currentTimeMillis,
          revision,
          takenAtMicros,
          overMicros: 0,
          cores,
          machineName: 'Computer',
          cpu: null,
          memory: UNREAD_MEMORY,
          groups: [],
          unresolvedParts: [...subscribers.values()].flatMap(({ parts }) => parts.map((part) => ({ part, reason: 'unknown' as const }))),
          unread: failure.detail,
        });
        spending.reset();
        machineSample = undefined;
        yield* Ref.set(heldRef, new Map());
        yield* woken();
      }),
      onSuccess: Effect.fnUntraced(function* (native: UsageRead) {
        const takenAtMicros = yield* monotonicMicros;
        const revision = (revisionValue += 1);
        const rows = new Map(native.processes.map((row) => [row.pid, row]));
        const endedRefs = new Map(ended.map((one) => [one.ref.execution as string, one.ref]));
        const spent = spending.next(
          native.processes,
          native.observedAt,
          native.takenAtMicros,
          ended.map((one) => ({ key: one.ref.execution, leader: one.leader, cpuMicros: one.cpuMicros })),
          holderPid,
        );
        const tree = new ProcessTree(
          native.processes.map((row) => ({ identity: { pid: row.pid, birth: row.birth }, parent: row.parent, work: row.work })),
        );
        const serverPids = [...new Set([...subscribers.values()].map((subscriber) => subscriber.serverPid))];
        const holderRow = rows.get(holderPid);
        const holderStanding =
          holder?._tag === 'Read' &&
          holderRow !== undefined &&
          identityMatch(holder, { pid: holderRow.pid, birth: holderRow.birth }) === 'same';
        const installation = new Map<number, InstallationRole>([
          ...serverPids.map((pid) => [pid, 'server'] as const),
          ...(hostPid > 0 ? [[hostPid, 'host'] as const] : []),
          ...(holderStanding ? [[holderPid, 'holder'] as const] : []),
        ]);
        const placement = place(rows, tree, watching, residuals, installation);
        if (topology.dropResiduals !== undefined && placement.gone.length > 0) yield* topology.dropResiduals(placement.gone);
        const latest = new Map<ExecutionId, UsageReading>();
        for (const observed of watching) {
          if (observed.leader === undefined) continue;
          latest.set(
            observed.ref.execution,
            readingStep(
              observed,
              placement.executions.get(observed.ref.execution) ?? [],
              rows,
              tree,
              spent,
              native,
              takenAtMicros,
              revision,
            ),
          );
        }
        yield* Ref.set(heldRef, latest);
        if (subscribers.size > 0) {
          const machine = machineOf(native.machine, takenAtMicros);
          const groups = withReaped(grouped(rows, placement.owners, spent, installation), spent.reaped, endedRefs);
          const measured = groups.reduce((sum, group) => sum + group.cores, 0);
          const kernel: ReadonlyArray<LoadGroup> =
            machine.cpu === null || machine.cpu <= measured
              ? []
              : [{ owner: { _tag: 'Kernel' }, cores: machine.cpu - measured, memoryBytes: 0, unread: 0, processes: [] }];
          const reading: LoadReading = {
            scope: scope,
            observedAt: native.observedAt,
            revision,
            takenAtMicros,
            overMicros: spent.overMicros,
            cores: machine.cores,
            machineName: 'Computer',
            cpu: machine.cpu,
            memory: machine.memory,
            groups: [...groups, ...kernel].sort((left, right) => right.cores - left.cores),
            unresolvedParts: [...subscribers.values()].flatMap(({ parts }) => parts.map((part) => ({ part, reason: 'unknown' as const }))),
            unread: machine.unread,
          };
          yield* Ref.set(frame, bounded(reading, budgetBytes));
          yield* Effect.annotateCurrentSpan({ processes: rows.size, groups: reading.groups.length });
          yield* recorder.record(reading, latest);
        }
        yield* woken();
      }),
    });
  });

  function woken(): Effect.Effect<void> {
    return Effect.flatMap(Ref.getAndSet(wakeRef, Deferred.makeUnsafe<void>()), (standing) =>
      Effect.asVoid(Deferred.succeed(standing, undefined)),
    );
  }

  function machineOf(read: UsageRead['machine'], takenAtMicros: number): MachineReading {
    if ('unavailable' in read) {
      machineSample = undefined;
      return { cores, cpu: null, memory: UNREAD_MEMORY, unread: read.unavailable };
    }
    const before = machineSample;
    machineSample = { counters: read, takenAtMicros };
    const busy = before === undefined ? 0 : read.busy - before.counters.busy;
    const total = before === undefined ? 0 : read.total - before.counters.total;
    const valid = before !== undefined && total > 0 && busy >= 0 && busy <= total;
    return { cores: read.cores, cpu: valid ? (busy / total) * read.cores : null, memory: read.memory };
  }

  function readingStep(
    observed: ObservedExecution,
    members: ReadonlyArray<number>,
    rows: ReadonlyMap<number, ProcessCounters>,
    tree: ProcessTree,
    spent: Spent,
    native: UsageRead,
    takenAtMicros: number,
    revision: number,
  ): UsageReading {
    const leader = observed.leader!;
    const relations = tree.relations({ pid: leader.pid });
    let cores = 0;
    let unread = 0;
    let current: ProcessWitness | undefined;
    const processes: ProcessUsageRow[] = [];
    for (const pid of members) {
      const row = rows.get(pid);
      if (row === undefined) continue;
      const relation = relations.get(pid) ?? 'ancestry';
      const spentCores = spent.cores.get(pid);
      if (row.cpu === undefined) unread += 1;
      cores += spentCores ?? 0;
      processes.push({
        identity: { pid, birth: row.birth },
        parent: row.parent > 0 ? row.parent : undefined,
        work: row.work > 0 ? row.work : undefined,
        cpuMicros: row.cpu?.micros ?? 0,
        residentBytes: row.residentBytes ?? 0,
        memoryKind: row.footprintBytes === undefined ? undefined : 'footprint',
        footprintBytes: row.footprintBytes,
        association: {
          execution: observed.ref,
          relation,
          identity: relation === 'leader' ? identityMatch(leader, { pid, birth: row.birth }) : 'unknown',
        },
      });
      if (relation === 'leader') continue;
      const order = reader.compareBirth(row.birth, current?.birth ?? row.birth);
      if (typeof order === 'number' && (current === undefined || order >= 0)) current = { pid, birth: row.birth };
    }
    const footprints = processes.every((row) => row.footprintBytes !== undefined);
    return {
      scope: observed.scope,
      source: OWN,
      observedAt: native.observedAt,
      revision,
      takenAtMicros,
      execution: observed.ref,
      completeness: processes.length === 0 ? 'unavailable' : unread > 0 ? 'partial' : 'complete',
      unmeasured:
        unread === 0
          ? []
          : [{ region: `${unread} processes of this execution`, reason: 'refused', detail: 'their counters were not read this step' }],
      coverage: processes.length === 0 ? [] : COVERAGE,
      processes,
      current,
      cpu:
        processes.length === 0
          ? { _tag: 'Unknown', reason: 'unmeasured', detail: 'no process of this execution was listed' }
          : spent.overMicros === 0
            ? { _tag: 'Unknown', reason: 'first-sample', detail: 'one cumulative counter is not a rate' }
            : {
                _tag: 'Measured',
                cores,
                overMicros: spent.overMicros,
                population: { matched: processes.length - unread, born: 0, departed: 0 },
                completeness: unread > 0 ? 'partial' : 'complete',
                gaps: [],
              },
      memory:
        processes.length === 0
          ? { _tag: 'Unknown', reason: 'unknown', detail: 'no process was measured, so there is no memory to sum' }
          : { _tag: 'ResidentSum', bytes: processes.reduce((sum, row) => sum + row.residentBytes, 0), processes: processes.length },
      footprint:
        processes.length > 0 && footprints
          ? {
              _tag: 'Measured',
              kind: 'footprint',
              bytes: processes.reduce((sum, row) => sum + (row.footprintBytes ?? 0), 0),
              processes: processes.length,
            }
          : { _tag: 'Unknown', reason: 'unsupported', detail: 'not every process of this execution reported a footprint' },
    };
  }

  return {
    scope,
    latest,
    all,
    sampled,
    load: Ref.get(frame),
    subscribe,
    interest,
    parts,
    sample,
    refresh,
    sampling: readSampling(),
  } satisfies ProcessUsage;
});

const withReaped = (
  groups: ReadonlyArray<LoadGroup>,
  reaped: ReadonlyMap<string, number>,
  refs: ReadonlyMap<string, ExecutionRef>,
): ReadonlyArray<LoadGroup> => {
  if (reaped.size === 0) return groups;
  const left = new Map(reaped);
  const merged = groups.map((group) => {
    if (group.owner._tag !== 'Execution') return group;
    const cores = left.get(group.owner.execution.execution);
    if (cores === undefined) return group;
    left.delete(group.owner.execution.execution);
    return { ...group, cores: group.cores + cores };
  });
  for (const [execution, cores] of left) {
    const ref = refs.get(execution);
    if (ref !== undefined)
      merged.push({ owner: { _tag: 'Execution', execution: ref, ended: true }, cores, memoryBytes: 0, unread: 0, processes: [] });
  }
  return merged;
};

const encoder = new TextEncoder();
const sizeOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

const fits = (reading: LoadReading, budget: number): boolean => {
  const json = JSON.stringify(reading);
  return json.length * 3 <= budget || encoder.encode(json).byteLength <= budget;
};

const owned = (group: LoadGroup): boolean => group.owner._tag === 'Installation' || group.owner._tag === 'Execution';

const bounded = (reading: LoadReading, budget: number): LoadReading => {
  if (fits(reading, budget)) return reading;
  const plain: LoadReading = {
    ...reading,
    groups: reading.groups.map((group) => ({ ...group, processes: group.processes.map(({ command: _, ...one }) => one) })),
  };
  if (sizeOf(plain) <= budget) return plain;
  const spill = (owner: LoadGroup['owner']) => ({ owner, cores: 0, memoryBytes: 0, unread: 0, processes: [], took: 0 });
  const others = spill({ _tag: 'Program', key: 'overflow', name: 'Other programs' });
  const installation = spill({ _tag: 'Installation' });
  let used = sizeOf({ ...plain, groups: [others, installation] });
  const kept: LoadGroup[] = [];
  for (const group of plain.groups.toSorted((left, right) => Number(owned(right)) - Number(owned(left)))) {
    const shell = { ...group, processes: [] };
    const whole = sizeOf(group) + 1;
    const bare = sizeOf(shell) + 1;
    if (used + whole <= budget) {
      kept.push(group);
      used += whole;
    } else if (used + bare <= budget) {
      kept.push(shell);
      used += bare;
    } else {
      const into = owned(group) ? installation : others;
      into.cores += group.cores;
      into.memoryBytes += group.memoryBytes;
      into.unread += group.unread;
      into.took += 1;
    }
  }
  const spilled = [installation, others].flatMap(({ took, ...group }) => (took === 0 ? [] : [group]));
  return { ...plain, groups: [...kept, ...spilled].sort((left, right) => right.cores - left.cores) };
};

const monotonicMicros = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos / 1000n));
