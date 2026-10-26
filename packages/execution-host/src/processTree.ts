import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { ProcessIdentity } from '@runlith/executions/protocol/evidence';

export type ListedProcess = {
  readonly identity: ProcessIdentity;
  readonly parent?: number | undefined;
  readonly work?: number | undefined;
  readonly terminal?: string | undefined;
};

export type ListedLeader = { readonly pid: number; readonly terminal?: string | undefined };

export class ProcessTree {
  private readonly rows = new Map<number, ListedProcess>();
  private readonly children = new Map<number, number[]>();
  private readonly groups = new Map<number, number[]>();
  private readonly terminals = new Map<string, number[]>();

  constructor(rows: ReadonlyArray<ListedProcess>) {
    for (const row of rows) {
      const pid = row.identity.pid;
      this.rows.set(pid, row);
      if (row.parent !== undefined) this.add(this.children, row.parent, pid);
      if (row.work !== undefined && row.work > 0) this.add(this.groups, row.work, pid);
      if (row.terminal !== undefined) this.add(this.terminals, row.terminal, pid);
    }
  }

  private add<K>(index: Map<K, number[]>, key: K, pid: number): void {
    const held = index.get(key);
    if (held === undefined) index.set(key, [pid]);
    else held.push(pid);
  }

  process(pid: number): ListedProcess | undefined {
    return this.rows.get(pid);
  }

  assign<T>(roots: ReadonlyMap<number, T>, groups = true): ReadonlyMap<number, T> {
    const found = new Map(roots);
    const frontier = [...roots.keys()];
    for (let at = 0; at < frontier.length; at += 1) {
      const pid = frontier[at]!;
      const owner = found.get(pid)!;
      for (const child of this.children.get(pid) ?? []) {
        if (found.has(child)) continue;
        found.set(child, owner);
        frontier.push(child);
      }
    }
    const visited = new Set<number>();
    for (const [pid, owner] of groups ? roots : []) {
      const work = this.rows.get(pid)?.work;
      if (work === undefined || visited.has(work)) continue;
      visited.add(work);
      for (const member of this.groups.get(work) ?? []) if (!found.has(member)) found.set(member, owner);
    }
    return found;
  }

  relations(leader: ListedLeader, work = true): ReadonlyMap<number, NativeRelation> {
    const found = new Map<number, NativeRelation>();
    const row = this.rows.get(leader.pid);
    if (row !== undefined) found.set(leader.pid, 'leader');
    const seen = new Set<number>([leader.pid]);
    const frontier = [leader.pid];
    for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
      for (const pid of this.children.get(next) ?? []) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        frontier.push(pid);
        found.set(pid, 'ancestry');
      }
    }
    if (work && row?.work !== undefined) {
      for (const pid of this.groups.get(row.work) ?? []) if (!found.has(pid)) found.set(pid, 'work');
    }
    if (leader.terminal !== undefined) {
      for (const pid of this.terminals.get(leader.terminal) ?? []) if (!found.has(pid)) found.set(pid, 'terminal');
    }
    return found;
  }
}

export const relationsOf = (rows: ReadonlyArray<ListedProcess>, leader: ListedLeader): ReadonlyMap<number, NativeRelation> =>
  new ProcessTree(rows).relations(leader);
