import type { LoadProcess, ProcessIdentity } from '@runlith/executions/protocol/evidence';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ProcessReader } from './ProcessReader';
import type { ContainerCounter, ProcessCounters } from './UsageReader';

export const executionKey = (ref: ExecutionRef): string => `${ref.installation}/${ref.incarnation}/${ref.execution}`;

type Held = {
  readonly birth: string;
  readonly micros: number | undefined;
  readonly reapedMicros: number | undefined;
  readonly read: boolean;
  readonly parent: number;
  readonly parentBirth: string | undefined;
};

export type Reaped = {
  readonly key: string;
  readonly leader: { readonly pid: number; readonly birth?: string | undefined };
  readonly cpuMicros: number;
};

export type Spent = {
  readonly overMicros: number;
  readonly cores: ReadonlyMap<number, number | undefined>;
  readonly fromChildren: ReadonlyMap<number, number>;
  readonly gpu: ReadonlyMap<number, LoadProcess['gpu']>;
  readonly reaped: ReadonlyMap<string, number>;
  readonly containers: ReadonlyMap<string, number | undefined>;
  readonly ended: ReadonlySet<string>;
};

const ownOf = (counter: { readonly micros: number; readonly reapedMicros: number | undefined }): number =>
  counter.micros - (counter.reapedMicros ?? 0);

export class Spending {
  private held = new Map<number, Held>();
  private takenAtMicros: number | undefined;
  private observedAt = 0;
  private settled: ReadonlySet<string> | undefined;
  private containers = new Map<string, number>();
  private gpu = new Map<number, { readonly birth: string; readonly micros: number }>();

  constructor(private readonly reader: ProcessReader) {}

  reset(): void {
    this.held = new Map();
    this.takenAtMicros = undefined;
    this.settled = undefined;
    this.containers = new Map();
    this.gpu = new Map();
  }

  next(
    rows: ReadonlyArray<ProcessCounters>,
    observedAt: number,
    takenAtMicros: number,
    ended: ReadonlyArray<Reaped> = [],
    reaper?: number,
    containers: ReadonlyArray<ContainerCounter> = [],
    leaders: ReadonlyMap<string, ProcessIdentity> = new Map(),
  ): Spent {
    const before = this.held;
    const overMicros = this.takenAtMicros === undefined ? 0 : Math.max(0, takenAtMicros - this.takenAtMicros);
    const listed = new Map(rows.map((row) => [row.pid, row]));
    const deltas = new Map<number, number | undefined>();
    const owns = new Map<number, number>();
    const whole = new Set<number>();
    const held = new Map<number, Held>();
    for (const row of rows) {
      const earlier = before.get(row.pid);
      const same = earlier !== undefined && earlier.birth === row.birth ? earlier : undefined;
      const parentBirth = listed.get(row.parent)?.birth;
      if (row.cpu === undefined) {
        held.set(row.pid, {
          birth: row.birth,
          micros: same?.micros,
          reapedMicros: same?.reapedMicros,
          read: false,
          parent: row.parent,
          parentBirth,
        });
        deltas.set(row.pid, undefined);
        continue;
      }
      held.set(row.pid, {
        birth: row.birth,
        micros: row.cpu.micros,
        reapedMicros: row.cpu.reapedMicros,
        read: true,
        parent: row.parent,
        parentBirth,
      });
      const counting = row.cpu.reapedMicros !== undefined;
      if (overMicros === 0 || same?.read === false) deltas.set(row.pid, undefined);
      else if (same?.micros !== undefined) {
        const own = ownOf(row.cpu) - ownOf({ micros: same.micros, reapedMicros: same.reapedMicros });
        if (counting !== (same.reapedMicros !== undefined)) deltas.set(row.pid, own);
        else {
          deltas.set(row.pid, row.cpu.micros - same.micros);
          if (counting) {
            whole.add(row.pid);
            owns.set(row.pid, own);
          }
        }
      } else if (same === undefined && this.reader.bornBetween(row.birth, this.observedAt, observedAt) === true) {
        deltas.set(row.pid, row.cpu.micros);
        if (counting) {
          whole.add(row.pid);
          owns.set(row.pid, ownOf(row.cpu));
        }
      } else deltas.set(row.pid, undefined);
    }
    const departed = (pid: number, birth: string | undefined): boolean => {
      const standing = listed.get(pid);
      return standing === undefined || standing.birth !== birth;
    };
    for (const [pid, gone] of before) {
      if (!departed(pid, gone.birth)) continue;
      let up = gone;
      for (let hops = 0; hops < 64; hops += 1) {
        const above = before.get(up.parent);
        if (above === undefined || above.birth !== up.parentBirth || !departed(up.parent, above.birth)) break;
        up = above;
      }
      const reaper = listed.get(up.parent);
      if (reaper === undefined || reaper.birth !== up.parentBirth) continue;
      if (!gone.read && whole.has(up.parent)) {
        deltas.set(up.parent, undefined);
        whole.delete(up.parent);
        continue;
      }
      const reaped = deltas.get(up.parent);
      if (reaped !== undefined && gone.micros !== undefined && whole.has(up.parent)) deltas.set(up.parent, reaped - gone.micros);
    }
    const newlyEnded = new Set(ended.filter((one) => this.settled !== undefined && !this.settled.has(one.key)).map((one) => one.key));
    const reapedMicros = this.reap(ended, before, listed, deltas, owns, whole, departed, reaper, observedAt);
    const containerCores = new Map<string, number | undefined>();
    const nextContainers = new Map<string, number>();
    for (const counter of containers) {
      const key = executionKey(counter.execution);
      const previous = this.containers.get(key);
      const birth = leaders.get(key)?.birth;
      const born = birth !== undefined && this.reader.bornBetween(birth, this.observedAt, observedAt) === true;
      const delta = previous === undefined ? (born ? counter.cpuMicros : undefined) : counter.cpuMicros - previous;
      containerCores.set(key, overMicros > 0 && delta !== undefined && delta >= 0 ? delta / overMicros : undefined);
      nextContainers.set(key, counter.cpuMicros);
    }
    this.containers = nextContainers;
    const gpu = new Map<number, LoadProcess['gpu']>();
    const nextGpu = new Map<number, { readonly birth: string; readonly micros: number }>();
    for (const row of rows) {
      if (row.gpu._tag === 'Unavailable') {
        gpu.set(row.pid, row.gpu);
        continue;
      }
      const beforeGpu = this.gpu.get(row.pid);
      const same = beforeGpu?.birth === row.birth ? beforeGpu : undefined;
      const born = this.reader.bornBetween(row.birth, this.observedAt, observedAt) === true;
      const delta = same === undefined ? (born ? row.gpu.micros : undefined) : row.gpu.micros - same.micros;
      gpu.set(
        row.pid,
        overMicros > 0 && delta !== undefined && delta >= 0
          ? { _tag: 'Measured', cores: delta / overMicros }
          : { _tag: 'Unavailable', reason: 'the GPU counter has no comparable earlier reading' },
      );
      nextGpu.set(row.pid, { birth: row.birth, micros: row.gpu.micros });
    }
    this.gpu = nextGpu;
    this.held = held;
    this.takenAtMicros = takenAtMicros;
    this.observedAt = observedAt;
    const cores = new Map<number, number | undefined>();
    const fromChildren = new Map<number, number>();
    for (const [pid, delta] of deltas) {
      if (delta === undefined || overMicros === 0) {
        cores.set(pid, undefined);
        continue;
      }
      const charged = Math.max(0, delta);
      cores.set(pid, charged / overMicros);
      const own = owns.get(pid);
      if (own !== undefined) fromChildren.set(pid, (charged - Math.min(charged, Math.max(0, own))) / overMicros);
    }
    const reapedCores = new Map<string, number>();
    if (overMicros > 0) for (const [key, micros] of reapedMicros) reapedCores.set(key, micros / overMicros);
    return { overMicros, cores, fromChildren, gpu, reaped: reapedCores, containers: containerCores, ended: newlyEnded };
  }

  //! a leader's final rusage lands in its reaper's child counter; the reaper hands the part not yet charged back to its execution
  private reap(
    ended: ReadonlyArray<Reaped>,
    before: ReadonlyMap<number, Held>,
    listed: ReadonlyMap<number, ProcessCounters>,
    deltas: Map<number, number | undefined>,
    owns: ReadonlyMap<number, number>,
    whole: ReadonlySet<number>,
    departed: (pid: number, birth: string | undefined) => boolean,
    reaper: number | undefined,
    observedAt: number,
  ): ReadonlyMap<string, number> {
    const charged = new Map<string, number>();
    const settled = new Set<string>();
    const priming = this.settled === undefined;
    for (const one of ended) {
      if (this.settled?.has(one.key) === true || priming || one.leader.birth === undefined) {
        settled.add(one.key);
        continue;
      }
      if (!departed(one.leader.pid, one.leader.birth)) continue;
      settled.add(one.key);
      const seen = before.get(one.leader.pid);
      const known = seen !== undefined && seen.birth === one.leader.birth ? seen : undefined;
      if (known !== undefined && !known.read) continue;
      if (known === undefined && this.reader.bornBetween(one.leader.birth, this.observedAt, observedAt) !== true) continue;
      const parent = known?.parent ?? reaper;
      const holder = parent === undefined ? undefined : listed.get(parent);
      if (holder === undefined || !whole.has(holder.pid)) continue;
      const available = deltas.get(holder.pid);
      const own = owns.get(holder.pid);
      if (available === undefined || own === undefined) continue;
      const fragment = Math.max(0, one.cpuMicros - (known?.micros ?? 0));
      if (fragment === 0 || fragment > available - Math.max(0, own)) continue;
      deltas.set(holder.pid, available - fragment);
      charged.set(one.key, fragment);
    }
    this.settled = settled;
    return charged;
  }
}
