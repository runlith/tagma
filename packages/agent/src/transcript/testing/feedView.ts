import { applyThreadEntryPlacement } from '../eventFold';
import { type FeedApply, type FeedHeld, step } from '../feedFold';
import type { FeedPosition, ThreadFeedEvent, ThreadLiveProgress, ThreadOpenEntry } from '../live';
import { appendedEntry } from '../openText';
import type { ThreadTranscriptEntry } from '../rows';

export class FeedView<TState> {
  at: FeedPosition | null = null;
  state: TState | null = null;
  transcript: readonly ThreadTranscriptEntry[] = [];
  open: readonly ThreadOpenEntry[] = [];
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
      record: (id) => {
        const open = this.open.find((one) => one.entry.id === id);
        if (open !== undefined) return open;
        const entry = this.transcript.find((one) => one.id === id);
        return entry === undefined ? undefined : { entry, from: 0 };
      },
      ofRun: (runId) => this.transcript.filter((entry) => 'runId' in entry && entry.runId === runId),
      open: (id) => this.open.some((one) => one.entry.id === id),
      openOfRun: (runId) => this.open.flatMap((one) => ('runId' in one.entry && one.entry.runId === runId ? [one.entry.id] : [])),
      openIds: () => this.open.map((one) => one.entry.id),
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
        if (apply.closesOpen && 'entry' in placement) this.open = this.open.filter((one) => one.entry.id !== placement.entry.id);
        this.transcript = applyThreadEntryPlacement(this.transcript, placement);
        return;
      }
      case 'progress':
        this.progress = apply.progress;
        return;
      case 'put': {
        const put = { entry: apply.entry, from: apply.from };
        const at = this.open.findIndex((one) => one.entry.id === apply.entry.id);
        this.open = at < 0 ? [...this.open, put] : this.open.map((one, index) => (index === at ? put : one));
        return;
      }
      case 'append':
        this.open = this.open.map((one) => (one.entry.id === apply.id ? { ...one, entry: appendedEntry(one.entry, apply.text) } : one));
        return;
      case 'drop':
        if (!this.open.some((one) => one.entry.id === apply.id) && this.transcript.some((entry) => entry.id === apply.id)) {
          throw new Error(`The feed dropped ${apply.id}, which the reader holds journaled.`);
        }
        this.open = this.open.filter((one) => one.entry.id !== apply.id);
        return;
    }
  }
}
