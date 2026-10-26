import { isActivityEntry, toolStartedAt, type ActivityEntry } from './activity';
import type { ChatLiveStatus } from './liveStatus';
import type { VisibleFeed } from './VisibleFeed';

export type LivePeekValue =
  | { readonly kind: 'working'; readonly status: ChatLiveStatus }
  | { readonly kind: 'status'; readonly status: ChatLiveStatus }
  | { readonly kind: 'step'; readonly entry: ActivityEntry; readonly clock: ChatLiveStatus; readonly live: boolean };

export type LivePeekState = {
  readonly value: LivePeekValue | null;
  readonly nextAt: number | null;
};

const APPEAR_MS = 250;
const HOLD_MS = 500;

export class LivePeek {
  private runId: string | null = null;
  private readonly observed = new Map<string, number>();
  private selected: string | null = null;
  private shownAt = 0;

  constructor(private readonly feed: VisibleFeed) {}

  read(status: ChatLiveStatus | null, now: number, visible: boolean, clockOffset = 0): LivePeekState {
    if (this.feed.runId !== this.runId) {
      this.runId = this.feed.runId;
      this.observed.clear();
      this.selected = null;
    }
    if (status === null || !status.pulse || status.waiting !== null) {
      this.selected = null;
      this.observed.clear();
      return { value: status === null ? null : { kind: 'status', status }, nextAt: null };
    }

    const active = new Set<string>();
    let candidate: ActivityEntry | null = null;
    let nextAt: number | null = null;
    for (const entry of this.feed.live) {
      active.add(entry.id);
      let observed = this.observed.get(entry.id);
      if (observed === undefined) {
        observed = now;
        this.observed.set(entry.id, observed);
      }
      const occurred = entry.occurredAt === undefined ? NaN : Date.parse(entry.occurredAt);
      const started = (entry.kind === 'tool' ? toolStartedAt(entry) : null) ?? (Number.isFinite(occurred) ? occurred : null);
      const since = started === null ? observed : started - clockOffset;
      const readyAt = since + APPEAR_MS;
      if (readyAt <= now) candidate = entry;
      else nextAt = nextAt === null ? readyAt : Math.min(nextAt, readyAt);
    }
    for (const id of this.observed.keys()) if (!active.has(id)) this.observed.delete(id);

    if (!visible) {
      this.selected = null;
      return { value: { kind: 'working', status }, nextAt: null };
    }
    if (this.selected !== null) {
      const running = this.feed.live.get(this.selected);
      if (running !== undefined) return { value: { kind: 'step', entry: running, clock: status, live: true }, nextAt: null };
      const ended = this.feed.rows.get(this.selected);
      if (ended !== undefined && isActivityEntry(ended) && now < this.shownAt + HOLD_MS) {
        return { value: { kind: 'step', entry: ended, clock: status, live: false }, nextAt: this.shownAt + HOLD_MS };
      }
      this.selected = null;
    }
    if (candidate !== null) {
      this.selected = candidate.id;
      this.shownAt = now;
      return { value: { kind: 'step', entry: candidate, clock: status, live: true }, nextAt: null };
    }
    return { value: { kind: 'working', status }, nextAt };
  }
}
