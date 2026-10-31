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
    for (const [key, held] of entries) this.ledger.set(key, held);
    this.settle(this.merged([...entries.values()].map((held) => held.item)));
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

  private merged(arriving: readonly T[]): readonly T[] {
    const order = this.options.order;
    if (order === undefined) return [...this.list, ...arriving];
    const incoming = [...arriving].sort((left, right) => order(left) - order(right));
    const next: T[] = [];
    let at = 0;
    for (const item of incoming) {
      const rank = order(item);
      while (at < this.list.length && order(this.list[at] as T) <= rank) next.push(this.list[at++] as T);
      next.push(item);
    }
    while (at < this.list.length) next.push(this.list[at++] as T);
    return next;
  }

  private settle(list: readonly T[]): void {
    this.list = list;
    this.shown.current = list;
  }
}
