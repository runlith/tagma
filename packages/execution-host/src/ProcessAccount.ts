import type { ExecutionId } from '@runlith/executions/protocol/execution';
import {
  identityMatch,
  sameProcess,
  type GroupOwner,
  type InstallationRole,
  type LoadGroup,
  type LoadProcess,
} from '@runlith/executions/protocol/evidence';
import type { ObservedExecution } from './ProcessEvidence';
import type { Spent } from './processSpending';
import type { ProcessTree } from './processTree';
import type { ResidualProcess } from './Residuals';
import type { ProcessCounters } from './UsageReader';

export type Placement = {
  readonly owners: ReadonlyMap<number, GroupOwner>;
  readonly executions: ReadonlyMap<ExecutionId, ReadonlyArray<number>>;
  readonly gone: ReadonlyArray<ResidualProcess>;
};

const INSTALLATION: GroupOwner = { _tag: 'Installation' };

export const keyOf = (owner: GroupOwner): string => {
  switch (owner._tag) {
    case 'Execution':
      return `execution:${owner.execution.installation}/${owner.execution.incarnation}/${owner.execution.execution}`;
    case 'Installation':
      return 'installation';
    case 'Part':
      return `part:${owner.key}`;
    case 'Program':
      return `program:${owner.key}`;
    case 'Kernel':
      return 'kernel';
  }
};

export const place = (
  rows: ReadonlyMap<number, ProcessCounters>,
  tree: ProcessTree,
  watching: ReadonlyArray<ObservedExecution>,
  residuals: ReadonlyArray<ResidualProcess>,
  installation: ReadonlyMap<number, InstallationRole>,
  parts: ReadonlyMap<number, string>,
): Placement => {
  const roots = new Map<number, ObservedExecution>();
  for (const observed of watching) {
    const leader = observed.leader;
    const row = leader === undefined ? undefined : tree.process(leader.pid);
    if (leader !== undefined && row !== undefined && identityMatch(leader, row.identity) !== 'different') roots.set(leader.pid, observed);
  }
  const seeded = new Map(tree.assign(roots, false, true));
  for (const observed of watching)
    for (const member of observed.members ?? []) {
      const row = tree.process(member.pid);
      if (!seeded.has(member.pid) && row !== undefined && sameProcess(row.identity, member)) seeded.set(member.pid, observed);
    }
  const assigned = new Map(tree.assign(seeded, false, true));
  for (const [pid, observed] of tree.assign(roots, true, true)) if (!assigned.has(pid)) assigned.set(pid, observed);
  const owners = new Map<number, GroupOwner>();
  const executions = new Map<ExecutionId, number[]>();
  for (const [pid, observed] of assigned) {
    owners.set(pid, { _tag: 'Execution', execution: observed.ref, ended: false });
    const members = executions.get(observed.ref.execution);
    if (members === undefined) executions.set(observed.ref.execution, [pid]);
    else members.push(pid);
  }
  const gone: ResidualProcess[] = [];
  for (const residual of residuals) {
    const pid = residual.identity.pid;
    const row = rows.get(pid);
    if (
      row === undefined ||
      (residual.identity.birth !== undefined && residual.identity.birth !== row.birth) ||
      (row.zombie && residual.relation !== 'work')
    ) {
      gone.push(residual);
      continue;
    }
    if (residual.identity.birth === undefined) continue;
    const members = tree.assign(new Map([[pid, pid]]), residual.relation === 'work', true).keys();
    for (const member of members)
      if (!owners.has(member)) owners.set(member, { _tag: 'Execution', execution: residual.origin, ended: true });
  }
  const rootsOfParts = new Map<number, GroupOwner>();
  for (const [pid, key] of parts) if (!installation.has(pid)) rootsOfParts.set(pid, { _tag: 'Part', key });
  for (const root of installation.keys()) rootsOfParts.set(root, INSTALLATION);
  for (const [pid, owner] of tree.assign(rootsOfParts, false, true)) if (!owners.has(pid)) owners.set(pid, owner);
  for (const row of rows.values())
    if (!owners.has(row.pid))
      owners.set(row.pid, { _tag: 'Program', key: row.program.key, name: row.program.name, where: row.program.where });
  return { owners, executions, gone };
};

const memoryOf = (row: ProcessCounters): number | null => row.footprintBytes ?? row.residentBytes ?? null;

export const grouped = (
  rows: ReadonlyMap<number, ProcessCounters>,
  owners: ReadonlyMap<number, GroupOwner>,
  spent: Spent,
  installation: ReadonlyMap<number, InstallationRole>,
): ReadonlyArray<LoadGroup> => {
  const groups = new Map<
    string,
    { owner: GroupOwner; cores: number; gpuCores: number; gpuUnread: number; memoryBytes: number; unread: number; processes: LoadProcess[] }
  >();
  for (const row of rows.values()) {
    const owner = owners.get(row.pid);
    if (owner === undefined) continue;
    const key = keyOf(owner);
    let group = groups.get(key);
    if (group === undefined) {
      group = { owner, cores: 0, gpuCores: 0, gpuUnread: 0, memoryBytes: 0, unread: 0, processes: [] };
      groups.set(key, group);
    }
    const cores = spent.cores.get(row.pid) ?? null;
    const gpu = spent.gpu.get(row.pid) ?? { _tag: 'Unavailable' as const, reason: 'the GPU counter was not read' };
    const memoryBytes = memoryOf(row);
    group.cores += cores ?? 0;
    if (gpu._tag === 'Measured') group.gpuCores += gpu.cores;
    else group.gpuUnread += 1;
    group.memoryBytes += memoryBytes ?? 0;
    if (cores === null) group.unread += 1;
    group.processes.push({
      identity: { pid: row.pid, birth: row.birth },
      parent: row.parent > 0 ? row.parent : undefined,
      name: row.name,
      command: row.command,
      role: owner._tag === 'Installation' ? installation.get(row.pid) : undefined,
      cores,
      gpu,
      reapedCores: spent.fromChildren.get(row.pid),
      memoryBytes,
      signal: row.signal && owner._tag !== 'Installation' && owner._tag !== 'Part',
      unread:
        row.unread ??
        (cores === null ? 'its CPU over this interval is not known yet: it has no earlier reading to compare with' : undefined),
    });
  }
  const order = (left: { cores: number | null; memoryBytes: number | null }, right: { cores: number | null; memoryBytes: number | null }) =>
    (right.cores ?? 0) - (left.cores ?? 0) || (right.memoryBytes ?? 0) - (left.memoryBytes ?? 0);
  return [...groups.values()].map((group) => ({ ...group, processes: group.processes.sort(order) })).sort(order);
};
