import type { ProcessReader } from './ProcessReader';
import type { ProcessCounters } from './UsageReader';

type Held = {
  readonly birth: string;
  readonly micros: number | undefined;
  readonly reapedMicros: number | undefined;
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
  readonly reaped: ReadonlyMap<string, number>;
};

type Uncharged = { readonly birth: string; readonly micros: number };

const ownOf = (counter: { readonly micros: number; readonly reapedMicros: number | undefined }): number =>
  counter.micros - (counter.reapedMicros ?? 0);

export class Spending {
  private held = new Map<number, Held>();
  private takenAtMicros: number | undefined;
  private observedAt = 0;
  private settled: ReadonlySet<string> | undefined;
  private uncharged = new Map<number, Uncharged>();

  constructor(private readonly reader: ProcessReader) {}

  reset(): void {
    this.held = new Map();
    this.takenAtMicros = undefined;
    this.settled = undefined;
    this.uncharged = new Map();
  }

  next(
    rows: ReadonlyArray<ProcessCounters>,
    observedAt: number,
    takenAtMicros: number,
    ended: ReadonlyArray<Reaped> = [],
    reaper?: number,
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
          parent: row.parent,
          parentBirth,
        });
        deltas.set(row.pid, undefined);
        continue;
      }
      held.set(row.pid, { birth: row.birth, micros: row.cpu.micros, reapedMicros: row.cpu.reapedMicros, parent: row.parent, parentBirth });
      const counting = row.cpu.reapedMicros !== undefined;
      if (overMicros === 0) deltas.set(row.pid, undefined);
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
    const uncharged = new Map<number, Uncharged>();
    for (const [pid, owed] of this.uncharged) {
      if (listed.get(pid)?.birth !== owed.birth) continue;
      const delta = deltas.get(pid);
      if (delta === undefined) uncharged.set(pid, owed);
      else if (whole.has(pid)) deltas.set(pid, delta - owed.micros);
    }
    const departed = (pid: number, birth: string | undefined): boolean => {
      const standing = listed.get(pid);
      return standing === undefined || standing.birth !== birth;
    };
    for (const [pid, gone] of before) {
      if (!departed(pid, gone.birth) || gone.micros === undefined) continue;
      let up = gone;
      for (let hops = 0; hops < 64; hops += 1) {
        const above = before.get(up.parent);
        if (above === undefined || above.birth !== up.parentBirth || !departed(up.parent, above.birth)) break;
        up = above;
      }
      const reaper = listed.get(up.parent);
      if (reaper === undefined || reaper.birth !== up.parentBirth) continue;
      const reaped = deltas.get(up.parent);
      if (reaped !== undefined && whole.has(up.parent)) deltas.set(up.parent, reaped - gone.micros);
      else if (reaper.cpu === undefined && before.get(up.parent)?.reapedMicros !== undefined)
        uncharged.set(up.parent, { birth: reaper.birth, micros: (uncharged.get(up.parent)?.micros ?? 0) + gone.micros });
    }
    const reapedMicros = this.reap(ended, before, listed, deltas, owns, whole, departed, reaper, observedAt);
    this.uncharged = uncharged;
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
    return { overMicros, cores, fromChildren, reaped: reapedCores };
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
      if (known !== undefined && known.micros === undefined) continue;
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
