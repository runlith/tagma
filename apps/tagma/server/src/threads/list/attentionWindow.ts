import type { AttentionFeedEvent, AttentionRow } from '../contract/wire/attention.js';
import { byRank, sameRow, type Ranked } from './attention.js';

export class AttentionWindow {
  private sorted: Ranked[] = [];
  private held = new Map<string, Ranked>();
  private shown = new Map<string, AttentionRow>();
  private told = 0;

  constructor(private readonly size: number) {}

  open(ranked: readonly Ranked[]): AttentionFeedEvent {
    this.sorted = [...ranked];
    this.held = new Map(ranked.map((entry) => [entry.row.threadId, entry] as const));
    const window = this.sorted.slice(0, this.size);
    this.shown = new Map(window.map((entry) => [entry.row.threadId, entry.row] as const));
    this.told = this.sorted.length;
    return { type: 'list', rows: window.map((entry) => entry.row), total: this.told };
  }

  put(next: Ranked): AttentionFeedEvent | null {
    const prior = this.held.get(next.row.threadId);
    if (prior !== undefined) {
      if (sameRow(prior.row, next.row)) return null;
      this.unplace(prior);
    }
    this.held.set(next.row.threadId, next);
    this.sorted.splice(this.after(next.key), 0, next);
    return this.settle();
  }

  drop(threadId: string): AttentionFeedEvent | null {
    const prior = this.held.get(threadId);
    if (prior === undefined) return null;
    this.held.delete(threadId);
    this.unplace(prior);
    return this.settle();
  }

  private after(key: Ranked['key']): number {
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (byRank(this.sorted[middle]!.key, key) <= 0) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private unplace(entry: Ranked): void {
    this.sorted.splice(this.after(entry.key) - 1, 1);
  }

  private settle(): AttentionFeedEvent | null {
    const window = this.sorted.slice(0, this.size);
    const rows: AttentionRow[] = [];
    const present = new Set<string>();
    for (const entry of window) {
      present.add(entry.row.threadId);
      const prior = this.shown.get(entry.row.threadId);
      if (prior === undefined || !sameRow(prior, entry.row)) rows.push(entry.row);
    }
    const removed = [...this.shown.keys()].filter((threadId) => !present.has(threadId));
    if (rows.length === 0 && removed.length === 0 && this.told === this.sorted.length) return null;
    this.shown = new Map(window.map((entry) => [entry.row.threadId, entry.row] as const));
    this.told = this.sorted.length;
    return { type: 'change', rows, removed, total: this.told };
  }
}
