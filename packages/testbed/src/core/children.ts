import { basename } from 'node:path';
import type { Processes } from './processes.ts';

export const CHILD_KINDS = ['sqlite', 'git', 'other'] as const;
export type ChildKind = (typeof CHILD_KINDS)[number];
export type ByKind<T> = Record<ChildKind, T>;

export type Child = {
  readonly pid: number | undefined;
  readonly kind: ChildKind;
  readonly file: string;
  readonly site: string | undefined;
  cpu: number;
  final: boolean;
  measured: boolean;
};

const SQLITE_CHILD = /\/sqlite-process\/src\/child\.[jt]s$/;

export const commandOf = (via: string, args: readonly unknown[]): string[] => {
  const [first, second] = args;
  if (Array.isArray(first)) return first.map(String);
  const cmd = (first as { cmd?: unknown } | null | undefined)?.cmd;
  if (Array.isArray(cmd)) return cmd.map(String);
  if (typeof first !== 'string') return [];
  if (via === 'exec' || via === 'execSync') return first.trim().split(/\s+/);
  return [first, ...(Array.isArray(second) ? second.map(String) : [])];
};

export const kindOfCommand = (command: readonly string[]): ChildKind =>
  command.some((part) => SQLITE_CHILD.test(part)) ? 'sqlite' : basename(command[0] ?? '') === 'git' ? 'git' : 'other';

const zero = (): ByKind<number> => ({ sqlite: 0, git: 0, other: 0 });

export const makeChildren = (processes: () => Processes | undefined) => {
  const live = new Map<number, Child>();
  const pending: Child[] = [];
  const finished = zero();
  let known = 0;

  const sample = (child: Child): void => {
    if (child.final || child.pid === undefined) return;
    const now = processes()?.cpu(child.pid);
    if (now === undefined) return;
    child.measured = true;
    if (now > child.cpu) child.cpu = now;
  };

  return {
    add(child: Child): void {
      if (child.final && child.measured) known += child.cpu;
      if (child.pid === undefined || child.final) pending.push(child);
      else live.set(child.pid, child);
    },
    finish(child: Child, cpu: number | undefined): void {
      if (cpu !== undefined) {
        if (cpu > child.cpu) child.cpu = cpu;
        child.measured = true;
        known += child.cpu;
      }
      child.final = true;
    },
    known: (): number => known,
    cpu(): ByKind<number> {
      const totals = { ...finished };
      for (const child of live.values()) {
        sample(child);
        totals[child.kind] += child.cpu;
      }
      for (const child of pending) totals[child.kind] += child.cpu;
      return totals;
    },
    settle(): void {
      for (const [pid, child] of live) {
        if (!child.final) continue;
        finished[child.kind] += child.cpu;
        live.delete(pid);
      }
      for (const child of pending.splice(0)) {
        if (child.final) finished[child.kind] += child.cpu;
        else pending.push(child);
      }
    },
    find(pid: number): Child | undefined {
      return live.get(pid);
    },
  };
};

export type Children = ReturnType<typeof makeChildren>;
