import type { RowModel } from './timeline';

const KEEP_ALIVE_ROWS = 4;
const NO_KEYS: readonly string[] = [];

type LiveRow = { key: string; seen: number; index: number };

export class KeptRows {
  private readonly alive = new Map<string, { seen: number; index: number }>();
  private seenTick = 0;
  private kept: readonly string[] = NO_KEYS;
  private outside: readonly string[] = NO_KEYS;

  get held(): readonly string[] {
    return this.outside;
  }

  keep(keys: readonly string[]): void {
    this.kept = keys.length === 0 ? NO_KEYS : keys;
  }

  extend(window: number[], rows: RowModel, count: number): number[] {
    const withLive = this.withLiveRows(window, rows);
    if (this.kept.length === 0) return withLive;
    const extra: number[] = [];
    for (const key of this.kept) {
      const index = rows.indexOf(key);
      if (index >= 0 && index < count && !includes(withLive, index) && !extra.includes(index)) extra.push(index);
    }
    return extra.length === 0
      ? withLive
      : merged(
          withLive,
          extra.sort((left, right) => left - right),
        );
  }

  clear(): void {
    this.alive.clear();
    this.kept = NO_KEYS;
    this.outside = NO_KEYS;
  }

  private withLiveRows(mounted: number[], rows: RowModel): number[] {
    this.seenTick += 1;
    for (const index of mounted) {
      const item = rows.itemAt(index);
      if (item?.keepAlive !== true) continue;
      const known = this.alive.get(item.key);
      if (known === undefined) this.alive.set(item.key, { seen: this.seenTick, index });
      else {
        known.seen = this.seenTick;
        known.index = index;
      }
    }
    if (this.alive.size === 0) {
      this.outside = NO_KEYS;
      return mounted;
    }
    let outside: LiveRow[] | undefined;
    for (const [key, known] of this.alive) {
      const index = liveRowAt(rows, key, known.index);
      if (index === undefined) {
        this.alive.delete(key);
        continue;
      }
      known.index = index;
      if (!includes(mounted, index)) (outside ??= []).push({ key, seen: known.seen, index });
    }
    if (outside === undefined) {
      this.outside = NO_KEYS;
      return mounted;
    }
    if (outside.length > KEEP_ALIVE_ROWS) {
      outside.sort((left, right) => right.seen - left.seen);
      for (const gone of outside.splice(KEEP_ALIVE_ROWS)) this.alive.delete(gone.key);
    }
    this.outside = outside.map((row) => row.key);
    return merged(
      mounted,
      outside.map((row) => row.index).sort((left, right) => left - right),
    );
  }
}

function liveRowAt(rows: RowModel, key: string, hint: number): number | undefined {
  const hinted = rows.itemAt(hint);
  if (hinted?.key === key) return hinted.keepAlive === true ? hint : undefined;
  const found = rows.indexOf(key);
  return found >= 0 && rows.itemAt(found)!.keepAlive === true ? found : undefined;
}

function includes(sorted: readonly number[], value: number): boolean {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = sorted[middle]!;
    if (at === value) return true;
    if (at < value) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function merged(sorted: readonly number[], extra: readonly number[]): number[] {
  const out: number[] = [];
  let next = 0;
  for (const value of sorted) {
    while (next < extra.length && extra[next]! < value) out.push(extra[next++]!);
    out.push(value);
  }
  while (next < extra.length) out.push(extra[next++]!);
  return out;
}
