import type { Cell } from './cell.js';
import { clashOf } from './RegistryClash.js';

type Held<T> = { readonly contributor: string; readonly item: T };

interface RosterOptions<T> {
  readonly order?: (item: T) => number;
}

const NONE: readonly never[] = [];

export class Roster<T> {
  private readonly ledger = new Map<string, Held<T>>();
  private list: readonly T[] = NONE;

  constructor(
    private readonly subject: (key: string) => string,
    private readonly keyOf: (item: T) => string,
    private readonly shown: Cell<readonly T[]>,
    private readonly options: RosterOptions<T> = {},
  ) {}

  get items(): readonly T[] {
    return this.shown.current ?? NONE;
  }

  find(key: string): T | undefined {
    return this.items.find((item) => this.keyOf(item) === key);
  }

  add(contributor: string, ...items: readonly T[]): () => void {
    const entries = new Map<string, Held<T>>();
    for (const item of items) {
      const key = this.keyOf(item);
      const clash = this.ledger.get(key) ?? entries.get(key);
      if (clash !== undefined) throw clashOf(this.subject(key), clash.contributor, contributor);
      entries.set(key, { contributor, item });
    }
    const next = [...this.list];
    for (const [key, held] of entries) {
      this.ledger.set(key, held);
      next.splice(this.placeOf(next, held.item), 0, held.item);
    }
    this.settle(next);
    return () => {
      const gone = new Set<T>();
      for (const [key, held] of entries) {
        if (this.ledger.get(key) !== held) continue;
        this.ledger.delete(key);
        gone.add(held.item);
      }
      if (gone.size > 0) this.settle(this.list.filter((item) => !gone.has(item)));
    };
  }

  contributorOf(match: (item: T) => boolean): string | undefined {
    for (const held of this.ledger.values()) if (match(held.item)) return held.contributor;
    return undefined;
  }

  private placeOf(list: readonly T[], item: T): number {
    const order = this.options.order;
    if (order === undefined) return list.length;
    const rank = order(item);
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (order(list[middle] as T) <= rank) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private settle(list: readonly T[]): void {
    this.list = list;
    this.shown.current = list;
  }
}
