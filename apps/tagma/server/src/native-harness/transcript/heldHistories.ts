import type { ThreadHistory } from '@runlith/agent/thread/rows';

import { atUnitEnd } from '../../platform/store/life.js';
import type { GuidanceIndex } from './guidanceIndex.js';

export type HistoryState = {
  readonly stored: ThreadHistory;
  readonly cursor: number;
  readonly through: number;
  readonly guidance: GuidanceIndex;
};

export type HistoryClaim = { readonly id: string; readonly entry: Entry };

export type Glimpse = { readonly entry: Entry };

type Weight = { readonly bytes: number; readonly messages: number };

type Weighed = { readonly history: ThreadHistory; readonly weight: Weight };

type Entry = {
  readonly history: ThreadHistory | null | undefined;
  readonly standing?: HistoryState;
  readonly weight?: Weight;
  readonly prior?: Weighed;
  readonly bytes: number;
};

type Message = ThreadHistory[number];

const HELD_RESIDENT_BYTES = 128 * 1024 * 1024;
const RESIDENT_PER_BYTE = 1.2;
const RESIDENT_PER_MESSAGE = 160;

export class HeldHistories {
  private readonly entries = new Map<string, Entry>();
  private readonly sizes = new WeakMap<Message, number>();
  private total = 0;

  constructor(private readonly residentBytes = HELD_RESIDENT_BYTES) {}

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

  glimpse(id: string, reader: object): Glimpse {
    const standing = this.entries.get(id);
    if (standing !== undefined) return { entry: standing };
    const entry: Entry = { history: undefined, bytes: 0 };
    this.entries.set(id, entry);
    atUnitEnd(reader, () => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
    return { entry };
  }

  claim(id: string, writer: object): HistoryClaim {
    const prior = weighedOf(this.entries.get(id));
    const claim: HistoryClaim = { id, entry: prior === undefined ? { history: null, bytes: 0 } : { history: null, prior, bytes: 0 } };
    this.drop(id);
    this.entries.set(id, claim.entry);
    atUnitEnd(writer, () => {
      if (this.entries.get(id) === claim.entry) this.drop(id);
    });
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

  weigh(message: Message, bytes: number): void {
    if (!this.sizes.has(message)) this.sizes.set(message, bytes);
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
    const weight = this.weighed(weighedOf(held), history);
    const kept = weight === null ? null : this.beside(weight, history, standing.stored);
    this.drop(id);
    if (weight === null || kept === null) return;
    const bytes = Math.ceil(kept.bytes * RESIDENT_PER_BYTE) + kept.messages * RESIDENT_PER_MESSAGE;
    if (bytes > this.residentBytes) return;
    this.entries.set(id, { history, standing, weight, bytes });
    this.total += bytes;
    while (this.total > this.residentBytes) {
      for (const [oldest, entry] of this.entries) {
        if (entry.history == null) continue;
        this.drop(oldest);
        break;
      }
    }
  }

  private weighed(prior: Weighed | undefined, history: ThreadHistory): Weight | null {
    const before = prior?.history ?? EMPTY;
    let shared = 0;
    const common = Math.min(before.length, history.length);
    while (shared < common && before[shared] === history[shared]) shared += 1;
    let bytes = prior?.weight.bytes ?? 0;
    for (let at = shared; at < before.length; at += 1) bytes -= this.sizes.get(before[at]!) ?? 0;
    for (let at = shared; at < history.length; at += 1) {
      const size = this.sizes.get(history[at]!);
      if (size === undefined) return null;
      bytes += size;
    }
    return { bytes, messages: history.length };
  }

  private beside(weight: Weight, history: ThreadHistory, stored: ThreadHistory): Weight | null {
    if (stored === history) return weight;
    let shared = 0;
    const common = Math.min(stored.length, history.length);
    while (shared < common && stored[shared] === history[shared]) shared += 1;
    let bytes = weight.bytes;
    for (let at = shared; at < stored.length; at += 1) {
      const size = this.sizes.get(stored[at]!);
      if (size === undefined) return null;
      bytes += size;
    }
    return { bytes, messages: weight.messages + stored.length - shared };
  }

  private drop(id: string): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.total -= entry.bytes;
    this.entries.delete(id);
  }
}

const EMPTY: ThreadHistory = [];

const weighedOf = (entry: Entry | undefined): Weighed | undefined =>
  entry?.history != null && entry.weight !== undefined ? { history: entry.history, weight: entry.weight } : entry?.prior;
