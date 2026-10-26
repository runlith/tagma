import type { ThreadHistory } from '@runlith/agent/thread/rows';

import type { GuidanceIndex } from './guidanceIndex.js';

export type HistoryState = {
  readonly stored: ThreadHistory;
  readonly cursor: number;
  readonly through: number;
  readonly guidance: GuidanceIndex;
};

export type HistoryClaim = { readonly id: string; readonly entry: Entry };

export type Glimpse = { readonly entry: Entry };

type Entry = { readonly history: ThreadHistory | null | undefined; readonly standing?: HistoryState; readonly bytes: number };

const HELD_CEILING_BYTES = 128 * 1024 * 1024;

export class HeldHistories {
  private readonly entries = new Map<string, Entry>();
  private readonly sizes = new WeakMap<object, number>();
  private total = 0;
  private readonly released = new FinalizationRegistry<HistoryClaim>((claim) => {
    if (this.entries.get(claim.id) === claim.entry) this.drop(claim.id);
  });

  constructor(private readonly ceilingBytes = HELD_CEILING_BYTES) {}

  held(id: string): { readonly history: ThreadHistory; readonly standing: HistoryState; readonly entry: Entry } | null {
    const entry = this.entries.get(id);
    const history = entry?.history;
    const standing = entry?.standing;
    if (entry === undefined || history == null || standing === undefined) return null;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return { history, standing, entry };
  }

  current(id: string, entry: Entry): boolean {
    return this.entries.get(id) === entry;
  }

  glimpse(id: string): Glimpse {
    const entry = this.entries.get(id) ?? { history: undefined, bytes: 0 };
    this.entries.set(id, entry);
    const seen = { entry };
    if (entry.history === undefined) this.released.register(seen, { id, entry });
    return seen;
  }

  claim(id: string, writer: object): HistoryClaim {
    const claim: HistoryClaim = { id, entry: { history: null, bytes: 0 } };
    this.drop(id);
    this.entries.set(id, claim.entry);
    this.released.register(writer, claim);
    return claim;
  }

  settle(claim: HistoryClaim, history: ThreadHistory, standing: HistoryState): void {
    if (this.entries.get(claim.id) !== claim.entry) return;
    this.publish(claim.id, history, standing);
  }

  offer(id: string, seen: Glimpse, history: ThreadHistory, standing: HistoryState): void {
    if (seen.entry.history === null) return;
    if (this.entries.get(id) !== seen.entry) return;
    this.publish(id, history, standing);
  }

  weigh(message: ThreadHistory[number], bytes: number): void {
    this.sizes.set(message, bytes);
  }

  private publish(id: string, history: ThreadHistory, standing: HistoryState): void {
    const held = this.entries.get(id);
    if (
      held?.history === history &&
      held.standing?.stored === standing.stored &&
      held.standing.cursor === standing.cursor &&
      held.standing.through === standing.through
    )
      return;
    let bytes = held?.history === history && held.standing?.stored === standing.stored ? held.bytes : undefined;
    if (bytes === undefined) {
      bytes = 0;
      for (const message of new Set([...history, ...standing.stored])) {
        let size = this.sizes.get(message);
        if (size === undefined) {
          size = JSON.stringify(message).length * 2;
          this.sizes.set(message, size);
        }
        bytes += size;
      }
    }
    this.drop(id);
    if (bytes > this.ceilingBytes) return;
    this.entries.set(id, { history, standing, bytes });
    this.total += bytes;
    while (this.total > this.ceilingBytes) {
      for (const [oldest, entry] of this.entries) {
        if (entry.history == null) continue;
        this.drop(oldest);
        break;
      }
    }
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.total -= entry.bytes;
    this.entries.delete(id);
  }
}
