import { markThreadEntry, placeThreadEntry, type ThreadEntryPlacement, type ThreadEventDelta, type TranscriptHeld } from './eventFold';
import type { FeedPosition, ThreadFeedEvent, ThreadLiveProgress, ThreadOpenChange, ThreadOpenEntry } from './live';
import { joinedOpen } from './openText';
import type { ThreadTranscriptEntry } from './rows';

export type FeedHeld = {
  readonly at: FeedPosition | null;
  entry(id: string): ThreadTranscriptEntry | undefined;
  record(id: string): ThreadOpenEntry | undefined;
  ofRun(runId: string): readonly ThreadTranscriptEntry[];
  open(id: string): boolean;
  openOfRun(runId: string): readonly string[];
  openIds(): Iterable<string>;
};

export type FeedApply =
  | {
      readonly op: 'reset';
      readonly transcript: readonly ThreadTranscriptEntry[];
      readonly before: number | null;
      readonly open: readonly ThreadOpenEntry[];
      readonly progress: ThreadLiveProgress | null;
    }
  | { readonly op: 'place'; readonly placement: ThreadEntryPlacement; readonly closesOpen: boolean }
  | ThreadOpenChange;

export type FeedStep<TState> = {
  readonly at: FeedPosition;
  readonly state: TState | null;
  readonly apply: readonly FeedApply[];
};

export function step<TState>(held: FeedHeld, event: ThreadFeedEvent<TState>): FeedStep<TState> | 'gap' {
  switch (event.type) {
    case 'snapshot': {
      const { transcript, before, progress } = event.payload.snapshot;
      const open = event.payload.snapshot.open.map((one) => joinedOpen(held.record(one.entry.id), one));
      return { at: event.at, state: event.payload.snapshot, apply: [{ op: 'reset', transcript, before, open, progress }] };
    }
    case 'resume': {
      if (held.at === null || event.payload.from.position > held.at.position) return 'gap';
      if (!covers(held.at.position, event.payload.records, event.at.position)) return 'gap';
      const view = new HeldView(held);
      const apply = view.records(held.at.position, event.payload.records);
      apply.push(...view.reopen(event.payload.open, event.payload.progress));
      return { at: advanced(held.at, event.at), state: event.payload.snapshot, apply };
    }
    case 'state': {
      if (held.at === null || event.at.seq !== held.at.seq + 1) return 'gap';
      if (!covers(held.at.position, event.payload.records, event.at.position)) return 'gap';
      return {
        at: advanced(held.at, event.at),
        state: event.payload.snapshot,
        apply: new HeldView(held).records(held.at.position, event.payload.records),
      };
    }
    case 'open': {
      if (held.at === null || event.at.seq !== held.at.seq + 1) return 'gap';
      return { at: advanced(held.at, event.at), state: null, apply: new HeldView(held).change(event.change) };
    }
  }
}

function covers(held: number, records: readonly ThreadEventDelta[], through: number): boolean {
  let next = held + 1;
  for (const record of records) {
    if (record.position <= held) continue;
    if (record.position !== next) return false;
    next += 1;
  }
  return next > through || through <= held;
}

function advanced(held: FeedPosition, at: FeedPosition): FeedPosition {
  return at.position >= held.position ? at : { position: held.position, seq: at.seq };
}

class HeldView implements TranscriptHeld {
  private readonly changed = new Map<string, ThreadTranscriptEntry | null>();
  private readonly appended: ThreadTranscriptEntry[] = [];
  private readonly prepended: ThreadTranscriptEntry[] = [];
  private readonly closed = new Set<string>();

  constructor(private readonly held: FeedHeld) {}

  entry(id: string): ThreadTranscriptEntry | undefined {
    const changed = this.changed.get(id);
    if (changed !== undefined) return changed ?? undefined;
    return this.held.entry(id);
  }

  ofRun(runId: string): readonly ThreadTranscriptEntry[] {
    const standing = this.held.ofRun(runId).flatMap((entry) => {
      const changed = this.changed.get(entry.id);
      if (changed === undefined) return [entry];
      return changed === null ? [] : [changed];
    });
    const placed = (entries: readonly ThreadTranscriptEntry[]) =>
      entries.flatMap((entry) => {
        if (runOf(entry) !== runId) return [];
        const current = this.changed.get(entry.id);
        return current === null || current === undefined ? [] : [current];
      });
    return [...placed(this.prepended), ...standing, ...placed(this.appended)];
  }

  records(after: number, deltas: readonly ThreadEventDelta[]): FeedApply[] {
    const apply: FeedApply[] = [];
    for (const delta of deltas) {
      if (delta.position <= after) continue;
      if (delta.withdrawn) {
        for (const id of this.openOfRun(delta.withdrawn.runId)) {
          this.closed.add(id);
          apply.push({ op: 'drop', id });
        }
      }
      const placement = placeThreadEntry(this, delta);
      if (placement === null) continue;
      const closesOpen = landsEntry(placement) && this.isOpen(placement.entry.id);
      if (closesOpen) this.closed.add(placement.entry.id);
      this.place(placement);
      apply.push({ op: 'place', placement, closesOpen });
    }
    return apply;
  }

  reopen(entries: readonly ThreadOpenEntry[], progress: ThreadLiveProgress | null): FeedApply[] {
    const listed = new Set(entries.map((open) => open.entry.id));
    const apply: FeedApply[] = [];
    for (const id of this.held.openIds()) if (!this.closed.has(id) && !listed.has(id)) apply.push({ op: 'drop', id });
    for (const open of entries) apply.push(...this.change({ op: 'put', entry: open.entry, from: open.from }));
    apply.push({ op: 'progress', progress });
    return apply;
  }

  change(change: ThreadOpenChange): readonly FeedApply[] {
    if (change.op === 'drop') return this.isOpen(change.id) ? [change] : [];
    if (change.op !== 'put') return [change];
    const joined = joinedOpen(this.record(change.entry.id), change);
    const put: ThreadOpenChange = joined === change ? change : { op: 'put', entry: joined.entry, from: joined.from };
    if (put.from > 0 || this.isOpen(put.entry.id) || this.entry(put.entry.id) === undefined) return [put];
    return [{ op: 'place', placement: { kind: 'replace', entry: put.entry }, closesOpen: false }];
  }

  private record(id: string): ThreadOpenEntry | undefined {
    const changed = this.changed.get(id);
    if (changed === undefined) return this.held.record(id);
    return changed === null ? undefined : { entry: changed, from: 0 };
  }

  private isOpen(id: string): boolean {
    return !this.closed.has(id) && this.held.open(id);
  }

  private openOfRun(runId: string): readonly string[] {
    return this.held.openOfRun(runId).filter((id) => !this.closed.has(id));
  }

  private place(placement: ThreadEntryPlacement): void {
    switch (placement.kind) {
      case 'append':
        this.appended.push(placement.entry);
        this.changed.set(placement.entry.id, placement.entry);
        return;
      case 'prepend':
        this.prepended.push(placement.entry);
        this.changed.set(placement.entry.id, placement.entry);
        return;
      case 'replace':
        this.changed.set(placement.entry.id, placement.entry);
        return;
      case 'withdraw':
        for (const id of placement.ids) this.changed.set(id, null);
        return;
      case 'mark':
        for (const id of placement.ids) {
          const standing = this.entry(id);
          if (standing !== undefined) this.changed.set(id, markThreadEntry(standing, placement.rewound));
        }
        return;
    }
  }
}

function landsEntry(
  placement: ThreadEntryPlacement,
): placement is Extract<ThreadEntryPlacement, { readonly entry: ThreadTranscriptEntry }> {
  return placement.kind === 'append' || placement.kind === 'prepend' || placement.kind === 'replace';
}

function runOf(entry: ThreadTranscriptEntry): string | undefined {
  return 'runId' in entry && typeof entry.runId === 'string' ? entry.runId : undefined;
}
