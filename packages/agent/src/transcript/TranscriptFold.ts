import {
  branchedPlacement,
  markThreadEntry,
  placeThreadEntry,
  type ThreadEntryPlacement,
  type ThreadEventFact,
  type TranscriptHeld,
} from './eventFold';
import type { ThreadTranscript, ThreadTranscriptEntry } from './rows';

export class TranscriptFold implements TranscriptHeld {
  private entries: ThreadTranscriptEntry[];
  private readonly places = new Map<string, number>();
  private readonly runs = new Map<string, Set<string>>();

  constructor(seed: ThreadTranscript = []) {
    this.entries = [...seed];
    this.reindex();
  }

  entry(id: string): ThreadTranscriptEntry | undefined {
    const at = this.places.get(id);
    return at === undefined ? undefined : this.entries[at];
  }

  ofRun(runId: string): readonly ThreadTranscriptEntry[] {
    const ids = this.runs.get(runId);
    if (ids === undefined) return [];
    const places: number[] = [];
    for (const id of ids) {
      const at = this.places.get(id);
      if (at !== undefined) places.push(at);
    }
    places.sort((a, b) => a - b);
    return places.flatMap((at) => this.entries[at] ?? []);
  }

  place(fact: ThreadEventFact): ThreadEntryPlacement | null {
    const placement = fact.branched ? branchedPlacement(this.entries, fact.branched) : placeThreadEntry(this, fact);
    if (placement !== null) this.apply(placement);
    return placement;
  }

  take(): ThreadTranscript {
    return [...this.entries];
  }

  private apply(placement: ThreadEntryPlacement): void {
    switch (placement.kind) {
      case 'append': {
        this.entries.push(placement.entry);
        this.places.set(placement.entry.id, this.entries.length - 1);
        this.remember(placement.entry);
        return;
      }
      case 'replace': {
        const at = this.places.get(placement.entry.id);
        if (at === undefined) return;
        this.forgetRun(this.entries[at]);
        this.entries[at] = placement.entry;
        this.remember(placement.entry);
        return;
      }
      case 'prepend': {
        this.entries = [placement.entry, ...this.entries];
        this.reindex();
        return;
      }
      case 'withdraw': {
        const gone = new Set(placement.ids);
        this.entries = this.entries.filter((entry) => !gone.has(entry.id));
        this.reindex();
        return;
      }
      case 'mark': {
        for (const id of placement.ids) {
          const at = this.places.get(id);
          if (at !== undefined) this.entries[at] = markThreadEntry(this.entries[at]!, placement.rewound);
        }
        return;
      }
    }
  }

  private remember(entry: ThreadTranscriptEntry): void {
    const runId = entry.runId;
    if (runId === undefined) return;
    const held = this.runs.get(runId);
    if (held === undefined) this.runs.set(runId, new Set([entry.id]));
    else held.add(entry.id);
  }

  private forgetRun(entry: ThreadTranscriptEntry | undefined): void {
    const runId = entry?.runId;
    if (runId === undefined || entry === undefined) return;
    const held = this.runs.get(runId);
    if (held === undefined) return;
    held.delete(entry.id);
    if (held.size === 0) this.runs.delete(runId);
  }

  private reindex(): void {
    this.places.clear();
    this.runs.clear();
    for (const [at, entry] of this.entries.entries()) {
      this.places.set(entry.id, at);
      this.remember(entry);
    }
  }
}

export function foldTranscriptBatch(
  seed: ThreadTranscript,
  facts: Iterable<ThreadEventFact>,
): { transcript: ThreadTranscript; placements: readonly ThreadEntryPlacement[] } {
  const fold = new TranscriptFold(seed);
  const placements: ThreadEntryPlacement[] = [];
  for (const fact of facts) {
    const placement = fold.place(fact);
    if (placement !== null) placements.push(placement);
  }
  return { transcript: fold.take(), placements };
}
