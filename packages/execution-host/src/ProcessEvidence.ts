import { Clock, Effect } from 'effect';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type {
  EvidenceCompleteness,
  EvidenceScope,
  EvidenceSource,
  EvidenceSubject,
  IdentityMatch,
  ListenerReport,
  ListenerSnapshot,
  ProcessAssociation,
  ProcessIdentity,
  ProcessWitness,
  ProcessReport,
  ProcessSnapshot,
  UnmeasuredRegion,
} from '@runlith/executions/protocol/evidence';
import { identityMatch, sameProcess, sameScope } from '@runlith/executions/protocol/evidence';
import type { EvidenceScans, Scan } from './EvidenceScans';
import { ProcessTree } from './processTree';
import type { ResidualProcess } from './Residuals';

export type ObservedLeader = ProcessIdentity & {
  readonly terminal?: string | undefined;
};

export type ObservedExecution = {
  readonly ref: ExecutionRef;
  readonly scope: EvidenceScope;
  readonly leader?: ObservedLeader | undefined;
  readonly members?: ReadonlyArray<ProcessWitness>;
};

export type EndedExecution = {
  readonly ref: ExecutionRef;
  readonly leader: ProcessIdentity;
  readonly cpuMicros: number;
};

export type ExecutionTopology = {
  readonly of: (execution: ExecutionId) => Effect.Effect<ObservedExecution | undefined>;
  readonly watching: Effect.Effect<ReadonlyArray<ObservedExecution>>;
  readonly ended?: Effect.Effect<ReadonlyArray<EndedExecution>>;
  readonly residuals?: Effect.Effect<ReadonlyArray<ResidualProcess>>;
  readonly dropResiduals?: (rows: ReadonlyArray<ResidualProcess>) => Effect.Effect<void>;
};

type Answered = {
  readonly scope: EvidenceScope;
  readonly source: EvidenceSource;
  readonly observedAt: number;
  readonly completeness: EvidenceCompleteness;
  readonly unmeasured: ReadonlyArray<UnmeasuredRegion>;
  readonly revision: number;
  readonly subject: EvidenceSubject;
};

type Reach = { readonly _tag: 'Measure'; readonly leader: ObservedLeader } | { readonly _tag: 'Beyond'; readonly answered: Answered };

const OWN: EvidenceSource = { adapter: 'process-evidence', probe: 'topology' };

const UNMEASURED = 0;

export type ProcessEvidence = {
  readonly scope: EvidenceScope;
  readonly processes: (execution: ExecutionId) => Effect.Effect<ProcessReport | undefined>;
  readonly listeners: (execution: ExecutionId) => Effect.Effect<ListenerReport | undefined>;
  readonly inventory: (scope: EvidenceScope, taken?: Scan<ListenerSnapshot>) => Effect.Effect<ListenerReport>;
};

export type EvidenceInput = {
  readonly topology: ExecutionTopology;
  readonly scans: EvidenceScans;
};

export const makeProcessEvidence = Effect.fnUntraced(function* ({ topology, scans }: EvidenceInput) {
  const processes = Effect.fnUntraced(function* (execution: ExecutionId): Effect.fn.Return<ProcessReport | undefined> {
    const observed = yield* topology.of(execution);
    if (observed === undefined) return undefined;
    const subject: EvidenceSubject = { _tag: 'Execution', execution: observed.ref };
    const reach = yield* reachable(observed, subject);
    if (reach._tag === 'Beyond') return { ...reach.answered, processes: [] };
    const leader = reach.leader;
    const scan = yield* scanned(leader);
    const gap = identityGap(scan, leader, observed.ref);
    const claimed = gap.length === 0 ? associated(scan.found, leader, observed.ref) : [];
    const limits = [...unenumerated(leader), ...identityDoubt(scan, leader, observed.ref)];
    return {
      scope: observed.scope,
      source: sourceOf(claimed, OWN),
      observedAt: scan.observedAt,
      completeness: gap.length > 0 ? 'unavailable' : weakest([scan.completeness, limits.length === 0 ? 'complete' : 'partial']),
      unmeasured: [...scan.unmeasured, ...limits, ...gap],
      revision: scan.revision,
      subject,
      processes: claimed,
    };
  });

  const listeners = Effect.fnUntraced(function* (execution: ExecutionId): Effect.fn.Return<ListenerReport | undefined> {
    const observed = yield* topology.of(execution);
    if (observed === undefined) return undefined;
    const subject: EvidenceSubject = { _tag: 'Execution', execution: observed.ref };
    const reach = yield* reachable(observed, subject);
    if (reach._tag === 'Beyond') return { ...reach.answered, listeners: [] };
    const leader = reach.leader;
    const processes = yield* scanned(leader);
    const gap = identityGap(processes, leader, observed.ref);
    const limits = [...unenumerated(leader), ...identityDoubt(processes, leader, observed.ref)];
    const related = associated(processes.found, leader, observed.ref).filter((row) => row.association !== undefined);
    if (gap.length > 0 || related.length === 0) {
      return {
        scope: observed.scope,
        source: OWN,
        observedAt: processes.observedAt,
        completeness: gap.length > 0 ? 'unavailable' : weakest([processes.completeness, limits.length === 0 ? 'complete' : 'partial']),
        unmeasured: [...processes.unmeasured.map(inProcesses), ...limits, ...gap],
        revision: processes.revision,
        subject,
        listeners: [],
      };
    }
    const sockets = yield* scans.listeners({ _tag: 'Held', pids: related.map((process) => process.identity.pid) });
    const holders = new Map(related.map((process) => [process.identity.pid, process]));
    const unproved = sockets.found.filter((socket) => {
      const holder = holders.get(socket.holder.pid);
      return holder !== undefined && !sameProcess(socket.holder, holder.identity);
    });
    return {
      scope: observed.scope,
      source: sourceOf(sockets.found, OWN),
      observedAt: Math.min(processes.observedAt, sockets.observedAt),
      completeness: weakest([
        processes.completeness,
        sockets.completeness,
        unproved.length === 0 && limits.length === 0 ? 'complete' : 'partial',
      ]),
      unmeasured: [
        ...processes.unmeasured.map(inProcesses),
        ...sockets.unmeasured,
        ...limits,
        ...unproved.map((socket) => ({
          region: `the holder of port ${socket.port}`,
          reason: 'unknown' as const,
          detail: 'the socket holder is not the process related to this execution',
        })),
      ],
      revision: sockets.revision,
      subject,
      listeners: sockets.found.flatMap((listener) => held(listener, holders)),
    };
  });

  const inventory = Effect.fnUntraced(function* (scope: EvidenceScope, taken?: Scan<ListenerSnapshot>): Effect.fn.Return<ListenerReport> {
    const subject: EvidenceSubject = { _tag: 'Namespace' };
    if (!sameScope(scope, scans.scope)) {
      const observedAt = yield* Clock.currentTimeMillis;
      return { ...beyond(scope, subject, observedAt), listeners: [] };
    }
    const sockets = taken ?? (yield* scans.listeners({ _tag: 'Inventory' }));
    const led = (yield* topology.watching).flatMap((observed) =>
      observed.leader !== undefined && sameScope(observed.scope, scans.scope) ? [{ ref: observed.ref, leader: observed.leader }] : [],
    );
    if (sockets.found.length === 0 || led.length === 0) {
      return {
        scope,
        source: sourceOf(sockets.found, OWN),
        observedAt: sockets.observedAt,
        completeness: sockets.completeness,
        unmeasured: sockets.unmeasured,
        revision: sockets.revision,
        subject,
        listeners: sockets.found,
      };
    }
    const table = yield* scans.processes({ _tag: 'Table' });
    const tree = new ProcessTree(table.found);
    const holders = new Map<number, ProcessSnapshot>();
    const contested = new Set<number>();
    const limits: UnmeasuredRegion[] = [];
    for (const { ref, leader } of led) {
      limits.push(...identityGap(table, leader, ref), ...identityDoubt(table, leader, ref));
      for (const row of associated(table.found, leader, ref, tree)) {
        if (row.association === undefined) continue;
        const pid = row.identity.pid;
        const prior = holders.get(pid);
        if (prior === undefined) holders.set(pid, row);
        else if (prior.association?.execution.execution !== ref.execution) contested.add(pid);
      }
    }
    for (const pid of contested) holders.delete(pid);
    const unproved = sockets.found.filter((socket) => {
      const holder = holders.get(socket.holder.pid);
      return holder !== undefined && !sameProcess(socket.holder, holder.identity);
    });
    const shared = sockets.found.filter((socket) => contested.has(socket.holder.pid));
    return {
      scope,
      source: sourceOf(sockets.found, OWN),
      observedAt: Math.min(sockets.observedAt, table.observedAt),
      completeness: weakest([
        sockets.completeness,
        table.completeness === 'complete' ? 'complete' : 'partial',
        unproved.length === 0 && shared.length === 0 && limits.length === 0 ? 'complete' : 'partial',
      ]),
      unmeasured: [
        ...sockets.unmeasured,
        ...table.unmeasured.map(inProcesses),
        ...limits,
        ...unproved.map((socket) => ({
          region: `the holder of port ${socket.port}`,
          reason: 'unknown' as const,
          detail: 'the socket holder is not the process related to an execution',
        })),
        ...shared.map((socket) => ({
          region: `the holder of port ${socket.port}`,
          reason: 'unknown' as const,
          detail: 'the socket holder is related to more than one execution, so none is claimed',
        })),
      ],
      revision: sockets.revision,
      subject,
      listeners: sockets.found.map((listener) => held(listener, holders)[0] ?? listener),
    };
  });

  const reachable = Effect.fnUntraced(function* (observed: ObservedExecution, subject: EvidenceSubject): Effect.fn.Return<Reach> {
    const leader = observed.leader;
    if (sameScope(observed.scope, scans.scope) && leader !== undefined) return { _tag: 'Measure', leader };
    const observedAt = yield* Clock.currentTimeMillis;
    if (!sameScope(observed.scope, scans.scope)) {
      return { _tag: 'Beyond', answered: beyond(observed.scope, subject, observedAt) };
    }
    return {
      _tag: 'Beyond',
      answered: {
        scope: observed.scope,
        source: OWN,
        observedAt,
        completeness: 'unavailable',
        unmeasured: [
          {
            region: 'the processes of this execution',
            reason: 'unknown',
            detail: 'the host holds no native process for it, so there is no pid to measure from',
          },
        ],
        revision: UNMEASURED,
        subject,
      },
    };
  });

  function scanned(leader: ObservedLeader): Effect.Effect<Scan<ProcessSnapshot>> {
    const terminal = named(leader.terminal);
    return terminal === undefined ? scans.processes({ _tag: 'Pids', pids: [leader.pid] }) : scans.processes({ _tag: 'Terminal', terminal });
  }

  return { scope: scans.scope, processes, listeners, inventory } satisfies ProcessEvidence;
});

const named = (terminal: string | undefined): string | undefined => {
  if (terminal === undefined || terminal === '') return undefined;
  const bare = terminal.startsWith('/dev/') ? terminal.slice('/dev/'.length) : terminal;
  return bare === '' || bare.startsWith('-') ? undefined : bare;
};

const beyond = (scope: EvidenceScope, subject: EvidenceSubject, observedAt: number): Answered => ({
  scope,
  source: OWN,
  observedAt,
  completeness: 'unavailable',
  unmeasured: [
    {
      region: namespaceName(scope),
      reason: 'unsupported',
      detail: 'no probe of this host measures processes or sockets in that namespace',
    },
  ],
  revision: UNMEASURED,
  subject,
});

const namespaceName = (scope: EvidenceScope): string =>
  scope.host._tag === 'Local' ? `the namespaces of ${scope.host.machine}` : `the ${scope.host.kind} namespace ${scope.host.id}`;

const sourceOf = (rows: ReadonlyArray<ProcessSnapshot | ListenerSnapshot>, own: EvidenceSource): EvidenceSource => {
  const first = rows[0];
  if (first === undefined) return own;
  return rows.every((row) => row.source.adapter === first.source.adapter && row.source.probe === first.source.probe)
    ? first.source
    : { adapter: first.source.adapter, probe: 'mixed' };
};

const ORDER: ReadonlyArray<EvidenceCompleteness> = ['complete', 'partial', 'unavailable'];

const weakest = (values: ReadonlyArray<EvidenceCompleteness>): EvidenceCompleteness =>
  values.reduce((held, value) => (ORDER.indexOf(value) > ORDER.indexOf(held) ? value : held), 'complete');

const inProcesses = (region: UnmeasuredRegion): UnmeasuredRegion => ({
  ...region,
  region: `${region.region} (the process listing this answer stands on)`,
});

const leaderIdentity = (rows: ReadonlyArray<ProcessSnapshot>, leader: ObservedLeader): IdentityMatch =>
  identityMatch(leader, rows.find((row) => row.identity.pid === leader.pid)?.identity);

const identityGap = (scan: Scan<ProcessSnapshot>, leader: ObservedLeader, execution: ExecutionRef): ReadonlyArray<UnmeasuredRegion> =>
  leaderIdentity(scan.found, leader) === 'different'
    ? [
        {
          region: `the processes of execution ${execution.execution}`,
          reason: 'unknown' as const,
          detail: `pid ${leader.pid} now holds a process born outside this execution's start, so nothing measured under it is claimed`,
        },
      ]
    : [];

const identityDoubt = (scan: Scan<ProcessSnapshot>, leader: ObservedLeader, execution: ExecutionRef): ReadonlyArray<UnmeasuredRegion> =>
  leaderIdentity(scan.found, leader) === 'unknown'
    ? [
        {
          region: `the identity of execution ${execution.execution}`,
          reason: 'unknown' as const,
          detail: `nothing proved pid ${leader.pid} still holds the process this execution started`,
        },
      ]
    : [];

const unenumerated = (leader: ObservedLeader): ReadonlyArray<UnmeasuredRegion> =>
  named(leader.terminal) === undefined
    ? [
        {
          region: `processes descended from pid ${leader.pid}`,
          reason: 'unsupported' as const,
          detail: 'this execution owns no terminal, so the listing names its one process and nothing it started',
        },
      ]
    : [];

const associated = (
  rows: ReadonlyArray<ProcessSnapshot>,
  leader: ObservedLeader,
  execution: ExecutionRef,
  tree: ProcessTree = new ProcessTree(rows),
): ReadonlyArray<ProcessSnapshot> => {
  const identity = leaderIdentity(rows, leader);
  if (identity === 'different') return rows;
  const relations = tree.relations({ pid: leader.pid, terminal: named(leader.terminal) });
  return rows.map((row) => {
    const relation = relations.get(row.identity.pid);
    if (relation === undefined) return row;
    const association: ProcessAssociation = {
      execution,
      relation,
      identity: relation === 'leader' ? identity : 'unknown',
    };
    return { ...row, association };
  });
};

const held = (listener: ListenerSnapshot, holders: ReadonlyMap<number, ProcessSnapshot>): ReadonlyArray<ListenerSnapshot> => {
  const holder = holders.get(listener.holder.pid);
  if (holder === undefined || holder.association === undefined || !sameProcess(listener.holder, holder.identity)) return [];
  return [{ ...listener, association: holder.association }];
};
