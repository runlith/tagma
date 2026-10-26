import type { FeedHeld } from '@runlith/agent/transcript/feedFold';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';

export class FeedRecords {
  readonly open = new Set<string>();
  private readonly byId = new Map<string, ThreadTranscriptEntry>();
  private readonly runs = new Map<string, Set<string>>();

  get(id: string): ThreadTranscriptEntry | undefined {
    return this.byId.get(id);
  }

  store(raw: ThreadTranscriptEntry): void {
    const held = this.byId.get(raw.id);
    if (held !== undefined && runOf(held) !== runOf(raw)) this.unrun(held);
    this.byId.set(raw.id, raw);
    const runId = runOf(raw);
    if (runId === undefined) return;
    const ids = this.runs.get(runId);
    if (ids === undefined) this.runs.set(runId, new Set([raw.id]));
    else ids.add(raw.id);
  }

  forget(id: string): void {
    const held = this.byId.get(id);
    if (held === undefined) return;
    this.byId.delete(id);
    this.unrun(held);
    this.open.delete(id);
  }

  clear(): void {
    this.byId.clear();
    this.runs.clear();
    this.open.clear();
  }

  held(at: FeedPosition | null): FeedHeld {
    return {
      at,
      entry: (id) => (this.open.has(id) ? undefined : this.byId.get(id)),
      ofRun: (runId) => {
        const found: ThreadTranscriptEntry[] = [];
        for (const id of this.runs.get(runId) ?? []) {
          const raw = this.byId.get(id);
          if (raw !== undefined && !this.open.has(id)) found.push(raw);
        }
        return found;
      },
      open: (id) => this.open.has(id),
      openIds: () => this.open,
      openOfRun: (runId) => {
        const ids: string[] = [];
        for (const id of this.runs.get(runId) ?? []) if (this.open.has(id)) ids.push(id);
        return ids;
      },
    };
  }

  private unrun(raw: ThreadTranscriptEntry): void {
    const runId = runOf(raw);
    if (runId === undefined) return;
    const ids = this.runs.get(runId);
    ids?.delete(raw.id);
    if (ids?.size === 0) this.runs.delete(runId);
  }
}

function runOf(raw: ThreadTranscriptEntry): string | undefined {
  return typeof raw.runId === 'string' ? raw.runId : undefined;
}
