import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { ProcessIdentity } from '@runlith/executions/protocol/evidence';

export type ListedProcess = {
  readonly identity: ProcessIdentity;
  readonly parent?: number | undefined;
  readonly work?: number | undefined;
  readonly onBehalfOf?: number | undefined;
  readonly terminal?: string | undefined;
};

export type ListedLeader = { readonly pid: number; readonly terminal?: string | undefined };

export class ProcessTree {
  private readonly rows = new Map<number, ListedProcess>();
  private readonly children = new Map<number, number[]>();
  private readonly delegated = new Map<number, number[]>();
  private readonly groups = new Map<number, number[]>();
  private readonly terminals = new Map<string, number[]>();

  constructor(rows: ReadonlyArray<ListedProcess>) {
    for (const row of rows) {
      const pid = row.identity.pid;
      this.rows.set(pid, row);
      if (row.parent !== undefined) this.add(this.children, row.parent, pid);
      if (row.onBehalfOf !== undefined && row.onBehalfOf !== pid) this.add(this.delegated, row.onBehalfOf, pid);
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

  assign<T>(roots: ReadonlyMap<number, T>, groups = true, behalf = false): ReadonlyMap<number, T> {
    const found = behalf ? this.assignDelegated(roots) : this.assignParents(roots);
    if (!groups) return found;
    const augmented = new Map(roots);
    const visited = new Set<number>();
    for (const [pid, owner] of roots) {
      const work = this.rows.get(pid)?.work;
      if (work === undefined || visited.has(work)) continue;
      visited.add(work);
      for (const member of this.groups.get(work) ?? []) {
        if (found.has(member)) continue;
        found.set(member, owner);
        augmented.set(member, owner);
      }
    }
    return behalf && augmented.size > roots.size ? this.assignDelegated(augmented) : found;
  }

  private assignParents<T>(roots: ReadonlyMap<number, T>): Map<number, T> {
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
    return found;
  }

  private assignDelegated<T>(roots: ReadonlyMap<number, T>): Map<number, T> {
    const found = new Map(roots);
    const reachable = new Set(roots.keys());
    const frontier = [...roots.keys()];
    for (let at = 0; at < frontier.length; at += 1) {
      const pid = frontier[at]!;
      for (const next of [...(this.children.get(pid) ?? []), ...(this.delegated.get(pid) ?? [])]) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        frontier.push(next);
      }
    }
    for (const pid of this.rows.keys()) {
      if (!reachable.has(pid) || found.has(pid)) continue;
      const active = new Set<number>([pid]);
      const stack: Array<{ readonly pid: number; next: number; pending?: number }> = [{ pid, next: 0 }];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        if (frame.pending !== undefined) {
          const owner = found.get(frame.pending);
          frame.pending = undefined;
          if (owner !== undefined) {
            found.set(frame.pid, owner);
            active.delete(frame.pid);
            stack.pop();
            continue;
          }
        }
        if (frame.next >= 2) {
          active.delete(frame.pid);
          stack.pop();
          continue;
        }
        const row = this.rows.get(frame.pid);
        const dependency = frame.next++ === 0 ? row?.onBehalfOf : row?.parent;
        if (dependency === undefined || !reachable.has(dependency)) continue;
        if (found.has(dependency)) {
          found.set(frame.pid, found.get(dependency)!);
          active.delete(frame.pid);
          stack.pop();
        } else if (!active.has(dependency)) {
          frame.pending = dependency;
          active.add(dependency);
          stack.push({ pid: dependency, next: 0 });
        }
      }
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
