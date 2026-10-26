import { ATTACHED_CONTEXT_SIGNAL_TYPE } from '@runlith/agent/transcript/parts';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import type { ActivityEntry } from './activity';
import { ChunkedList } from './ChunkedList';
import { type ChatAttachedDoc, type ChatEntry, questionOpen } from './entries';
import type { EntryKinds, EntryTraits } from './EntryKinds.svelte';
import { isToolConfirmationEntry } from './entryProjection';
import { ChangeLog, type FeedChange, type FeedChanges, type FeedSource, patchOf, spliceOf } from './feedChanges';
import { type ChatLiveStatus, isLiveEntry } from './liveStatus';

type EntryOf<K extends ChatEntry['kind']> = Extract<ChatEntry, { kind: K }>;
type RunEnd = EntryOf<'run-end'>;
type Shown = { readonly rows: ChatEntry[]; readonly live: ActivityEntry[] };

export type FeedRun = { readonly id: string; readonly phase: ChatLiveStatus['phase'] | undefined };

export type FeedDelta = {
  readonly rows: FeedChanges<ChatEntry>;
  readonly live: FeedChanges<ActivityEntry>;
};

type Drift = { readonly rows: FeedChange<ChatEntry>[]; readonly live: FeedChange<ActivityEntry>[] };

const idOf = (entry: ChatEntry): string => entry.id;
const orphanId = (anchor: string): string => `attached-orphan:${anchor}`;

export class VisibleFeed {
  readonly log = new ChangeLog<FeedDelta>();
  private readonly input = new ChunkedList<ChatEntry>(idOf);
  private readonly shown = new ChunkedList<ChatEntry>(idOf);
  private readonly running = new ChunkedList<ActivityEntry>(idOf);
  private origin: FeedSource | null = null;
  private seen = -1;
  private moved = 0;
  private stamp = -1;
  private verbose: boolean | null = null;
  private runKey: string | null = null;
  private run: FeedRun | null = null;
  private readonly runs = new Map<string, Set<string>>();
  private pings = new Set<string>();
  private endings = new Map<string, RunEnd>();
  private retry: ChatEntry | undefined;
  private trailingId: string | null = null;
  private usersHeld: readonly ChatEntry[] | null = null;
  private confirmationsHeld: readonly EntryOf<'question'>[] | null = null;

  constructor(private readonly kinds: EntryKinds) {}

  get revision(): number {
    return this.log.revision;
  }

  get epoch(): number {
    return this.moved;
  }

  get rows(): ChunkedList<ChatEntry> {
    return this.shown;
  }

  get live(): ChunkedList<ActivityEntry> {
    return this.running;
  }

  get runId(): string | null {
    return this.run?.id ?? null;
  }

  get count(): number {
    return this.shown.length + this.running.length;
  }

  get trailing(): EntryOf<'ready-answers'> | null {
    return this.trailingId === null ? null : (this.input.get(this.trailingId) as EntryOf<'ready-answers'>);
  }

  get users(): readonly ChatEntry[] {
    this.usersHeld ??= this.shown.slice().filter((entry) => entry.kind === 'user' && entry.rewound === undefined);
    return this.usersHeld;
  }

  get confirmations(): readonly EntryOf<'question'>[] {
    if (this.confirmationsHeld === null) {
      const open: EntryOf<'question'>[] = [];
      for (const entry of this.input) if (entry.kind === 'question' && openConfirmation(entry)) open.push(entry);
      this.confirmationsHeld = open;
    }
    return this.confirmationsHeld;
  }

  get activeMessage(): string | undefined {
    const run = this.run;
    const users = this.users;
    if (run === null) return users.at(-1)?.id;
    let first = -1;
    this.input.eachBack((entry, index) => {
      if (entry.runId === run.id) {
        if (this.shown.has(entry.id) || this.running.has(entry.id)) first = index;
        return true;
      }
      return !(entry.runId !== undefined && first >= 0);
    });
    for (let index = users.length - 1; index >= 0; index -= 1) {
      if (first < 0 || this.input.indexOf(users[index]!.id) < first) return users[index]!.id;
    }
    return undefined;
  }

  since(revision: number): readonly FeedDelta[] | null {
    return this.log.since(revision);
  }

  snapshot(): Shown {
    return { rows: this.shown.slice(), live: this.running.slice() };
  }

  sync(source: FeedSource, verbose: boolean, run: FeedRun | null): void {
    const stamp = this.kinds.stamp();
    const revision = source.revision;
    const key = runKeyOf(run);
    const standing = this.seen >= 0 && this.origin === source && this.stamp === stamp && this.verbose === verbose;
    const batches = standing ? source.since(this.seen) : null;
    if (batches === null) {
      this.reload(source, verbose, run, stamp);
      return;
    }
    if (batches.length === 0 && key === this.runKey) {
      this.run = run;
      return;
    }
    const drift: Drift = { rows: [], live: [] };
    if (key !== this.runKey) this.reclassify(run, key, drift);
    else this.run = run;
    if (batches.length > 0) this.moved += 1;
    for (const batch of batches) {
      for (const change of batch) {
        if (this.apply(change, drift, true)) continue;
        this.reload(source, verbose, run, stamp);
        return;
      }
    }
    this.seen = revision;
    if (drift.rows.length > 0 || drift.live.length > 0) this.log.record(drift);
  }

  load(entries: readonly ChatEntry[], verbose: boolean, run: FeedRun | null = null, stamp = this.kinds.stamp()): void {
    const heldRows = this.shown.slice();
    const heldLive = this.running.slice();
    const heldTrailing = this.trailing;
    const heldConfirmations = this.confirmations;
    const standing = new Map<string, ChatEntry>();
    for (const row of heldRows) standing.set(row.id, row);
    for (const row of heldLive) standing.set(row.id, row);
    this.origin = null;
    this.stamp = stamp;
    this.verbose = verbose;
    this.run = run;
    this.runKey = runKeyOf(run);
    this.input.clear();
    this.input.splice(0, 0, entries);
    this.shown.clear();
    this.running.clear();
    this.readPings(entries);
    this.readRuns(entries);
    this.retry = this.retryOf(run);
    this.trailingId = this.scanTrailing();
    const made = this.emit(0, this.input.length);
    const keep = <T extends ChatEntry>(row: T): T => {
      const was = standing.get(row.id);
      return was !== undefined && (was === row || sameDerived(was, row)) ? (was as T) : row;
    };
    this.shown.splice(0, 0, made.rows.map(keep));
    this.running.splice(0, 0, made.live.map(keep));
    this.usersHeld = null;
    this.confirmationsHeld = null;
    const rowsHeld = sameRows(heldRows, this.shown) && sameRows(heldLive, this.running);
    if (rowsHeld && heldTrailing === this.trailing && sameList(heldConfirmations, this.confirmations)) return;
    if (!rowsHeld) this.log.restart();
    this.moved += 1;
  }

  private reload(source: FeedSource, verbose: boolean, run: FeedRun | null, stamp: number): void {
    this.load(source.snapshot(), verbose, run, stamp);
    this.origin = source;
    this.seen = source.revision;
  }

  private retryOf(run: FeedRun | null): ChatEntry | undefined {
    return run?.phase === 'retrying' ? this.input.findLast((entry) => entry.runId === run.id && entry.kind === 'retry') : undefined;
  }

  private reclassify(next: FeedRun | null, key: string | null, drift: Drift): void {
    const previous = this.run;
    this.run = next;
    this.runKey = key;
    this.retry = this.retryOf(next);
    let low = Number.POSITIVE_INFINITY;
    let high = -1;
    for (const run of [previous, next]) {
      for (const id of run === null ? [] : (this.runs.get(run.id) ?? [])) {
        const at = this.input.indexOf(id);
        if (at < 0) continue;
        low = Math.min(low, at);
        high = Math.max(high, at);
      }
    }
    if (high < 0) return;
    const start = this.chainStart(low);
    const end = this.chainEnd(low, high + 1);
    this.rewrite(start, end, this.input.slice(start, end), drift);
  }

  private apply(change: FeedChange<ChatEntry>, drift: Drift, retrail: boolean): boolean {
    const from = change.kind === 'patch' ? change.at : change.from;
    const removed: readonly ChatEntry[] = change.kind === 'patch' ? [this.input.at(from)!] : change.removed;
    const inserted: readonly ChatEntry[] = change.kind === 'patch' ? [change.item] : change.inserted;
    if (this.global(removed) || this.global(inserted)) return false;
    const start = this.chainStart(from);
    const endOld = this.chainEnd(from, from + removed.length);
    this.input.splice(from, removed.length, inserted);
    this.trackRuns(removed, inserted);
    const shift = inserted.length - removed.length;
    const endNew = this.chainEnd(from, from + inserted.length);
    const end = Math.max(endNew, endOld + shift);
    this.rewrite(start, end, this.oldWindow(start, end - shift, from, removed, shift), drift);
    if (touches(removed, inserted, 'question')) this.confirmationsHeld = null;
    if (touches(removed, inserted, 'error') && !this.reendings([...removed, ...inserted], drift)) return false;
    if (retrail && (touches(removed, inserted, 'user') || touches(removed, inserted, 'ready-answers'))) return this.retrail(drift);
    return true;
  }

  private toldFailed(ending: RunEnd): boolean {
    if (ending.status !== 'failed') return false;
    for (const id of this.runs.get(ending.runId) ?? []) if (this.input.get(id)?.kind === 'error') return true;
    return false;
  }

  private reendings(changed: readonly ChatEntry[], drift: Drift): boolean {
    for (const runId of new Set(changed.flatMap((entry) => (entry.kind === 'error' && entry.runId !== undefined ? [entry.runId] : [])))) {
      for (const id of [...(this.runs.get(runId) ?? [])]) {
        const at = this.input.indexOf(id);
        const entry = at < 0 ? undefined : this.input.at(at);
        if (entry?.kind === 'run-end' && !this.apply(patchOf(at, entry), drift, false)) return false;
      }
    }
    return true;
  }

  private rewrite(start: number, end: number, before: readonly ChatEntry[], drift: Drift): void {
    const goneRows = spanOf(this.shown, before, (entry) => [entry.id, orphanId(entry.id)]);
    const goneLive = spanOf(this.running, before, (entry) => [entry.id]);
    const made = this.emit(start, end);
    this.place(this.shown, goneRows, start, end, made.rows, drift.rows);
    this.place(this.running, goneLive, start, end, made.live, drift.live);
    if (before.some(isUser) || made.rows.some(isUser)) this.usersHeld = null;
  }

  private readRuns(entries: readonly ChatEntry[]): void {
    this.runs.clear();
    this.trackRuns([], entries);
  }

  private trackRuns(removed: readonly ChatEntry[], inserted: readonly ChatEntry[]): void {
    for (const entry of removed) if (entry.runId !== undefined) this.runs.get(entry.runId)?.delete(entry.id);
    for (const entry of inserted) {
      if (entry.runId === undefined) continue;
      const held = this.runs.get(entry.runId);
      if (held === undefined) this.runs.set(entry.runId, new Set([entry.id]));
      else held.add(entry.id);
    }
  }

  private retrail(drift: Drift): boolean {
    const next = this.scanTrailing();
    if (next === this.trailingId) return true;
    const was = this.trailingId;
    this.trailingId = next;
    for (const id of [was, next]) {
      if (id === null) continue;
      const at = this.input.indexOf(id);
      if (at >= 0 && !this.apply(patchOf(at, this.input.at(at)!), drift, false)) return false;
    }
    return true;
  }

  private scanTrailing(): string | null {
    const last = this.input.findLast((entry) => entry.kind === 'user' || entry.kind === 'ready-answers');
    return last?.kind === 'ready-answers' ? last.id : null;
  }

  private global(entries: readonly ChatEntry[]): boolean {
    for (const entry of entries) {
      if (isKeepWarm(entry)) return true;
      if (entry.runId !== undefined && this.pings.has(entry.runId)) return true;
      if (entry.kind === 'retry' && this.run?.phase === 'retrying') return true;
    }
    return false;
  }

  private chainStart(at: number): number {
    let start = at;
    while (start > 0 && this.linking(this.input.at(start - 1)!)) start -= 1;
    return start;
  }

  private chainEnd(from: number, to: number): number {
    const input = this.input;
    const last = to > from ? input.at(to - 1) : from > 0 ? input.at(from - 1) : undefined;
    let end = to;
    if (last === undefined || !this.linking(last)) return end;
    while (end < input.length && this.linking(input.at(end)!)) end += 1;
    if (end < input.length) end += 1;
    return end;
  }

  private skipped(entry: ChatEntry): boolean {
    return entry.id === this.trailingId || (entry.kind === 'question' && openConfirmation(entry));
  }

  private linking(entry: ChatEntry): boolean {
    return attaching(entry) || this.skipped(entry);
  }

  private oldWindow(start: number, end: number, from: number, removed: readonly ChatEntry[], shift: number): ChatEntry[] {
    const window: ChatEntry[] = [];
    for (let index = start; index < end; index += 1) {
      if (index < from) window.push(this.input.at(index)!);
      else if (index < from + removed.length) window.push(removed[index - from]!);
      else window.push(this.input.at(index + shift)!);
    }
    return window;
  }

  private place<T extends ChatEntry>(
    list: ChunkedList<T>,
    gone: Span,
    start: number,
    end: number,
    made: readonly T[],
    out: FeedChange<T>[],
  ): void {
    if (gone.count === 0 && made.length === 0) return;
    const first = gone.count > 0 ? gone.first : this.after(list, start, end);
    const old = list.slice(first, first + gone.count);
    const byId = new Map(old.map((row) => [row.id, row]));
    const next = made.map((row) => {
      const was = byId.get(row.id);
      return was !== undefined && (was === row || sameDerived(was, row)) ? was : row;
    });
    let head = 0;
    while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
    let tail = 0;
    while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
    const removed = old.slice(head, old.length - tail);
    const inserted = next.slice(head, next.length - tail);
    if (removed.length === 0 && inserted.length === 0) return;
    const at = first + head;
    if (removed.length === inserted.length && removed.every((row, index) => row.id === inserted[index]!.id)) {
      for (const [index, row] of inserted.entries()) {
        list.set(at + index, row);
        out.push(patchOf(at + index, row));
      }
      return;
    }
    list.splice(at, removed.length, inserted);
    out.push(spliceOf(at, removed, inserted));
  }

  private after<T extends ChatEntry>(list: ChunkedList<T>, start: number, end: number): number {
    const input = this.input;
    const mapped = (entry: ChatEntry): number[] => [list.indexOf(entry.id), list.indexOf(orphanId(entry.id))].filter((found) => found >= 0);
    for (let step = 0; ; step += 1) {
      const ahead = end + step;
      if (ahead >= input.length) return list.length;
      const forward = mapped(input.at(ahead)!);
      if (forward.length > 0) return Math.min(...forward);
      const behind = start - 1 - step;
      if (behind < 0) continue;
      const backward = mapped(input.at(behind)!);
      if (backward.length > 0) return Math.max(...backward) + 1;
    }
  }

  private readPings(entries: readonly ChatEntry[]): void {
    this.pings = new Set(entries.flatMap((entry) => (isKeepWarm(entry) && entry.runId !== undefined ? [entry.runId] : [])));
    this.endings = new Map(
      entries.flatMap((entry) => (entry.kind === 'run-end' && this.pings.has(entry.runId) ? [[entry.runId, entry] as const] : [])),
    );
  }

  private emit(from: number, to: number): Shown {
    const rows: ChatEntry[] = [];
    const live: ActivityEntry[] = [];
    const run = this.run;
    let pending: ChatAttachedDoc[] = [];
    let anchor = '';
    const show = (entry: ChatEntry) => {
      if (entry.kind === 'run-end' && (this.pings.has(entry.runId) || this.toldFailed(entry))) return;
      const stood = this.keptWarm(entry);
      const traits = this.kinds.classify(stood);
      if (traits.hidden || (!this.verbose && !this.visible(stood, traits))) return;
      if (run !== null && stood.runId === run.id && isLiveEntry(stood, this.retry)) live.push(stood);
      else rows.push(stood);
    };
    const flush = () => {
      if (pending.length === 0) return;
      const doc = pending[0]!;
      show(
        pending.length === 1
          ? {
              id: orphanId(anchor),
              kind: 'signal',
              signalType: ATTACHED_CONTEXT_SIGNAL_TYPE,
              addressee: 'reader',
              title: doc.title,
              text: doc.text,
            }
          : {
              id: orphanId(anchor),
              kind: 'signal',
              signalType: ATTACHED_CONTEXT_SIGNAL_TYPE,
              addressee: 'reader',
              text: '',
              attachedDocs: pending,
            },
      );
      pending = [];
    };
    for (const entry of this.input.slice(from, to)) {
      if (this.skipped(entry)) continue;
      if (entry.kind === 'signal' && entry.signalType === ATTACHED_CONTEXT_SIGNAL_TYPE) {
        if (pending.length === 0) anchor = entry.id;
        if (entry.attachedDocs?.length) pending.push(...entry.attachedDocs);
        else {
          const title = entry.title?.trim();
          pending.push({ title, text: entry.text });
        }
        continue;
      }
      if (entry.kind === 'user' && pending.length > 0) {
        show({ ...entry, attachedDocs: [...(entry.attachedDocs ?? []), ...pending] });
        pending = [];
        continue;
      }
      if (!isAttachBridge(entry)) flush();
      show(entry);
    }
    flush();
    return { rows, live };
  }

  private keptWarm(entry: ChatEntry): ChatEntry {
    if (!isKeepWarm(entry) || entry.runId === undefined) return entry;
    const ending = this.endings.get(entry.runId);
    if (ending === undefined) return entry;
    return {
      ...entry,
      keptWarm: {
        status: ending.status,
        usage: ending.usage,
        account: ending.account,
      },
    };
  }

  private visible(entry: ChatEntry, traits: EntryTraits): boolean {
    return (
      !traits.verboseOnly &&
      !((entry.kind === 'assistant' || entry.kind === 'reasoning') && entry.runId !== undefined && this.pings.has(entry.runId))
    );
  }
}

type Span = { readonly first: number; readonly count: number };

export function visibleChatEntries(kinds: EntryKinds, entries: readonly ChatEntry[], verbose: boolean): readonly ChatEntry[] {
  const feed = new VisibleFeed(kinds);
  feed.load(entries, verbose);
  return feed.rows.slice();
}

function spanOf<T extends ChatEntry>(list: ChunkedList<T>, window: readonly ChatEntry[], owned: (entry: ChatEntry) => string[]): Span {
  let first = -1;
  let last = -1;
  for (const entry of window) {
    for (const id of owned(entry)) {
      const at = list.indexOf(id);
      if (at < 0) continue;
      if (first < 0 || at < first) first = at;
      if (at > last) last = at;
    }
  }
  return first < 0 ? { first: 0, count: 0 } : { first, count: last - first + 1 };
}

function runKeyOf(run: FeedRun | null): string | null {
  return run === null ? null : `${run.id}:${run.phase === 'retrying'}`;
}

function sameList<T>(held: readonly T[], next: readonly T[]): boolean {
  return held.length === next.length && held.every((item, index) => item === next[index]);
}

function sameRows<T extends ChatEntry>(held: readonly T[], list: ChunkedList<T>): boolean {
  if (held.length !== list.length) return false;
  let at = 0;
  for (const row of list) {
    if (row !== held[at]) return false;
    at += 1;
  }
  return true;
}

function isUser(entry: ChatEntry): boolean {
  return entry.kind === 'user';
}

function touches(removed: readonly ChatEntry[], inserted: readonly ChatEntry[], kind: ChatEntry['kind']): boolean {
  return removed.some((entry) => entry.kind === kind) || inserted.some((entry) => entry.kind === kind);
}

function openConfirmation(entry: ChatEntry): boolean {
  return entry.kind === 'question' && questionOpen(entry) && isToolConfirmationEntry(entry);
}

function isAttachBridge(entry: ChatEntry): boolean {
  return entry.kind === 'system-prompt' || entry.kind === 'context' || entry.kind === 'runtime-guidance';
}

function attaching(entry: ChatEntry): boolean {
  return (entry.kind === 'signal' && entry.signalType === ATTACHED_CONTEXT_SIGNAL_TYPE) || isAttachBridge(entry);
}

function sameDerived(held: ChatEntry, next: ChatEntry): boolean {
  const a = held as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  const fields = Object.keys(a);
  if (fields.length !== Object.keys(b).length) return false;
  return fields.every((field) => a[field] === b[field] || sameValue(a[field], b[field]));
}

function sameValue(held: unknown, next: unknown): boolean {
  if (Array.isArray(held) && Array.isArray(next)) {
    return held.length === next.length && held.every((item, index) => sameValue(item, next[index]));
  }
  if (held === null || next === null || typeof held !== 'object' || typeof next !== 'object') return held === next;
  const a = held as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const fields = Object.keys(a);
  return fields.length === Object.keys(b).length && fields.every((field) => a[field] === b[field]);
}

function isKeepWarm(entry: ChatEntry): entry is EntryOf<'signal'> {
  return entry.kind === 'signal' && entry.signalType === KEEP_WARM_SIGNAL_TYPE;
}
