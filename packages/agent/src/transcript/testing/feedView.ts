import { applyThreadEntryPlacement } from '../eventFold';
import { appendedEntry, type FeedApply, type FeedHeld, step } from '../feedFold';
import type { FeedPosition, ThreadFeedEvent, ThreadLiveProgress } from '../live';
import type { ThreadTranscriptEntry } from '../rows';

export class FeedView<TState> {
  at: FeedPosition | null = null;
  state: TState | null = null;
  transcript: readonly ThreadTranscriptEntry[] = [];
  open: readonly ThreadTranscriptEntry[] = [];
  progress: ThreadLiveProgress | null = null;
  gaps = 0;

  take(event: ThreadFeedEvent<TState>): boolean {
    const taken = step<TState>(this.held(), event);
    if (taken === 'gap') {
      this.gaps += 1;
      return false;
    }
    for (const apply of taken.apply) this.apply(apply);
    this.at = taken.at;
    if (taken.state !== null) this.state = taken.state;
    return true;
  }

  private held(): FeedHeld {
    return {
      at: this.at,
      entry: (id) => this.transcript.find((entry) => entry.id === id),
      ofRun: (runId) => this.transcript.filter((entry) => 'runId' in entry && entry.runId === runId),
      open: (id) => this.open.some((entry) => entry.id === id),
      openOfRun: (runId) => this.open.flatMap((entry) => ('runId' in entry && entry.runId === runId ? [entry.id] : [])),
      openIds: () => this.open.map((entry) => entry.id),
    };
  }

  private apply(apply: FeedApply): void {
    switch (apply.op) {
      case 'reset':
        this.transcript = apply.transcript;
        this.open = apply.open;
        this.progress = apply.progress;
        return;
      case 'place': {
        const placement = apply.placement;
        if (apply.closesOpen && 'entry' in placement) this.open = this.open.filter((entry) => entry.id !== placement.entry.id);
        this.transcript = applyThreadEntryPlacement(this.transcript, placement);
        return;
      }
      case 'progress':
        this.progress = apply.progress;
        return;
      case 'put': {
        const at = this.open.findIndex((entry) => entry.id === apply.entry.id);
        this.open = at < 0 ? [...this.open, apply.entry] : this.open.map((entry, index) => (index === at ? apply.entry : entry));
        return;
      }
      case 'append':
        this.open = this.open.map((entry) => (entry.id === apply.id ? appendedEntry(entry, apply.text) : entry));
        return;
      case 'drop':
        if (!this.open.some((entry) => entry.id === apply.id) && this.transcript.some((entry) => entry.id === apply.id)) {
          throw new Error(`The feed dropped ${apply.id}, which the reader holds journaled.`);
        }
        this.open = this.open.filter((entry) => entry.id !== apply.id);
        return;
    }
  }
}
