import type { ToolDisplay } from '../../tool/display';
import type { ThreadToolEntry, ThreadToolExecution } from '../../transcript/entries';
import { toolEntryId } from '../../transcript/entryNames';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { coreEntry } from '../../transcript/kinds';
import { toJson } from '@runlith/utils/json';

export type ThreadRecordedFact =
  | { readonly kind: 'entry'; readonly entry: ThreadTranscriptEntry }
  | { readonly kind: 'replay'; readonly entry: ThreadTranscriptEntry }
  | { readonly kind: 'tool-settled'; readonly entry: ThreadToolEntry };

export type ThreadToolChange = { readonly toolDisplay: ToolDisplay } | { readonly execution: ThreadToolExecution };

export type ThreadFactBatch = {
  readonly facts: readonly ThreadRecordedFact[];
  readonly count: number;
};

export class ThreadFactQueue {
  private readonly facts: ThreadRecordedFact[] = [];

  push(fact: ThreadRecordedFact): void {
    this.facts.push(stored(fact));
  }

  batch(landsStep: boolean): ThreadFactBatch {
    const count = landsStep ? this.facts.length : firstReplayIndex(this.facts);
    return { facts: this.facts.slice(0, count), count };
  }

  held(count: number): readonly ThreadTranscriptEntry[] {
    return this.facts.slice(count).map((fact) => fact.entry);
  }

  take(count: number): void {
    this.facts.splice(0, count);
  }

  amendTool(toolCallId: string, change: ThreadToolChange): boolean {
    const id = toolEntryId(toolCallId);
    for (let index = this.facts.length - 1; index >= 0; index -= 1) {
      const fact = this.facts[index];
      if (fact?.kind !== 'entry' || !coreEntry(fact.entry) || fact.entry.type !== 'tool' || fact.entry.id !== id) continue;
      this.facts[index] = stored({ kind: 'entry', entry: { ...fact.entry, ...change } });
      return true;
    }
    return false;
  }

  interrupted(): readonly ThreadToolEntry[] {
    return this.facts.flatMap(({ entry }) =>
      coreEntry(entry) && entry.type === 'tool' && entry.toolInputRaw?.kind === 'text' ? [entry] : [],
    );
  }

  replaceTool(entry: ThreadToolEntry): void {
    for (let index = this.facts.length - 1; index >= 0; index -= 1) {
      const fact = this.facts[index];
      if (fact?.kind !== 'entry' || fact.entry.type !== 'tool' || fact.entry.id !== entry.id) continue;
      this.facts[index] = stored({ kind: 'entry', entry });
      return;
    }
  }

  dropTool(toolCallId: string): void {
    const id = toolEntryId(toolCallId);
    for (let index = this.facts.length - 1; index >= 0; index -= 1) {
      const fact = this.facts[index];
      if (fact?.kind === 'entry' && fact.entry.type === 'tool' && fact.entry.id === id) this.facts.splice(index, 1);
    }
  }
}

function stored(fact: ThreadRecordedFact): ThreadRecordedFact {
  return toJson(fact) as unknown as ThreadRecordedFact;
}

function firstReplayIndex(facts: readonly ThreadRecordedFact[]): number {
  const index = facts.findIndex((fact) => fact.kind === 'replay');
  return index < 0 ? facts.length : index;
}
