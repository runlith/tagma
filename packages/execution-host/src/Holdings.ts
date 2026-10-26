import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ChangesReset } from '@runlith/executions/protocol/inventory';

type Stamp = { readonly id: ExecutionId; readonly stamp: number; readonly left: ExecutionRef | undefined };

export type HoldingsChanges<T> =
  | { readonly _tag: 'Changed'; readonly revision: number; readonly moved: ReadonlyArray<T>; readonly left: ReadonlyArray<ExecutionRef> }
  | { readonly _tag: 'Reset'; readonly revision: number; readonly reason: ChangesReset; readonly detail: string };

export type HoldingsPage<T> = { readonly rows: ReadonlyArray<T>; readonly more: boolean };

const COMPACT_SLACK = 1024;

export class Holdings<T> {
  private readonly live = new Map<ExecutionId, T>();
  private readonly order: ExecutionId[] = [];
  private readonly standing = new Map<ExecutionId, Stamp>();
  private log: Stamp[] = [];
  private readonly departures: Stamp[] = [];
  private departed = 0;
  private revisionNow = 0;
  private horizon = 0;

  constructor(private readonly departuresKept: number) {}

  get revision(): number {
    return this.revisionNow;
  }

  get size(): number {
    return this.live.size;
  }

  get(id: ExecutionId): T | undefined {
    return this.live.get(id);
  }

  has(id: ExecutionId): boolean {
    return this.live.has(id);
  }

  all(): ReadonlyArray<T> {
    return [...this.live.values()];
  }

  hold(id: ExecutionId, value: T): void {
    if (!this.live.has(id)) this.order.splice(this.seek(id, false), 0, id);
    this.live.set(id, value);
  }

  moved(id?: ExecutionId): number {
    this.revisionNow += 1;
    if (id !== undefined && this.live.has(id)) this.stamp(id, this.revisionNow, undefined);
    return this.revisionNow;
  }

  touched(id: ExecutionId): void {
    if (!this.live.has(id)) return;
    const next = this.revisionNow + 1;
    if (this.standing.get(id)?.stamp === next) return;
    this.stamp(id, next, undefined);
  }

  release(ref: ExecutionRef): number {
    const id = ref.execution;
    this.revisionNow += 1;
    if (!this.live.delete(id)) return this.revisionNow;
    const at = this.seek(id, false);
    if (this.order[at] === id) this.order.splice(at, 1);
    this.depart(this.stamp(id, this.revisionNow, ref));
    return this.revisionNow;
  }

  retired(ref: ExecutionRef): number {
    this.revisionNow += 1;
    if (!this.live.has(ref.execution)) this.depart(this.stamp(ref.execution, this.revisionNow, ref));
    return this.revisionNow;
  }

  page(after: ExecutionId | undefined, limit: number | undefined): HoldingsPage<T> {
    const from = after === undefined ? 0 : this.seek(after, true);
    const end = limit === undefined ? this.order.length : Math.min(this.order.length, from + limit);
    const rows: T[] = [];
    for (let at = from; at < end; at += 1) rows.push(this.live.get(this.order[at] as ExecutionId) as T);
    return { rows, more: end < this.order.length };
  }

  changes(since: number, limit: number): HoldingsChanges<T> {
    const revision = this.revisionNow;
    if (since > revision) {
      return { _tag: 'Reset', revision, reason: 'ahead', detail: `revision ${since} is past this host's ${revision}` };
    }
    if (since < this.horizon) {
      return {
        _tag: 'Reset',
        revision,
        reason: 'horizon',
        detail: `departures through revision ${this.horizon} are no longer kept, and the reading stands at ${since}`,
      };
    }
    const moved: T[] = [];
    const left: ExecutionRef[] = [];
    for (let at = this.log.length - 1; at >= 0; at -= 1) {
      const entry = this.log[at] as Stamp;
      if (entry.stamp <= since) break;
      if (this.standing.get(entry.id) !== entry) continue;
      if (moved.length + left.length === limit) {
        return {
          _tag: 'Reset',
          revision,
          reason: 'overflow',
          detail: `more than ${limit} executions moved after revision ${since}`,
        };
      }
      if (entry.left !== undefined) left.push(entry.left);
      else moved.push(this.live.get(entry.id) as T);
    }
    return { _tag: 'Changed', revision, moved: moved.reverse(), left: left.reverse() };
  }

  private depart(entry: Stamp): void {
    this.departures.push(entry);
    this.departed += 1;
    while (this.departed > this.departuresKept) {
      const oldest = this.departures.shift() as Stamp;
      this.departed -= 1;
      if (this.standing.get(oldest.id) === oldest) this.standing.delete(oldest.id);
      if (oldest.stamp > this.horizon) this.horizon = oldest.stamp;
    }
  }

  private stamp(id: ExecutionId, stamp: number, left: ExecutionRef | undefined): Stamp {
    const entry: Stamp = { id, stamp, left };
    this.standing.set(id, entry);
    this.log.push(entry);
    if (this.log.length > 2 * this.standing.size + COMPACT_SLACK) {
      this.log = this.log.filter((kept) => this.standing.get(kept.id) === kept);
    }
    return entry;
  }

  private seek(id: ExecutionId, past: boolean): number {
    let low = 0;
    let high = this.order.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const at = this.order[middle] as ExecutionId;
      if (at < id || (past && at === id)) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
