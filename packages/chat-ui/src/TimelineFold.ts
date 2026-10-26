import {
  type ActivityEntry,
  type ActivityGroup,
  type ActivityRow,
  activityKey,
  activityRows,
  activityThoughtsOnly,
  firstLabelLine,
  railPlace,
} from './activity';
import { ChunkedList } from './ChunkedList';
import type { ChatEntry } from './entries';
import type { EntryKinds } from './EntryKinds.svelte';
import type { FeedChange } from './feedChanges';
import {
  type ChatRowView,
  FEED_GAP_PX,
  liveStatusEstimate,
  rewindEstimate,
  type RowSizing,
  rowOpen,
  stepEstimate,
  stretchEstimate,
  TextHeights,
  ViewSizing,
} from './rowEstimate';
import {
  CHAT_TAIL_ITEMS,
  type ChatLiveWork,
  type ChatTailSlot,
  type ChatTimelineItem,
  itemOccurredAt,
  type RowModel,
  rewindKey,
  sameTimelineItem,
} from './timeline';
import { groupOf, localDayKey, type Emitted, type Seg, marked, rowEntryIds, runsOf, type Segment, segmentsOf } from './timelineSegments';
import type { VisibleFeed } from './VisibleFeed';

type Placed = Exclude<ChatTimelineItem, { kind: 'tail' }>;
type Dated = Exclude<Placed, { kind: 'status' }>;
type Unspaced = Dated extends infer TItem ? (TItem extends Dated ? Omit<TItem, 'spaced'> : never) : never;

export type LiveWork = { readonly runId: string; readonly status: boolean };

const DAY_BOUNDARY_PX = 34;
const LIVE_STATUS_KEY = 'live:status';

const UNTOUCHED: ChatRowView = {
  expanded: (_key, fallback) => fallback,
  stretchDefault: (_key, newest) => newest,
  toolOpen: () => undefined,
};

const idOf = (entry: ChatEntry): string => entry.id;

export class TimelineFold implements RowModel {
  revision = 0;
  shape = 0;
  private origin: VisibleFeed | null = null;
  private seen = -1;
  private stamp = -1;
  private view: ChatRowView | null = null;
  private sizing: RowSizing = new ViewSizing(UNTOUCHED, new TextHeights());
  private readonly heights = new TextHeights();
  private readonly input = new ChunkedList<ChatEntry>(idOf);
  private readonly liveInput = new ChunkedList<ActivityEntry>(idOf);
  private readonly table = new ChunkedList<Seg>((seg) => seg.key);
  private readonly ownerOf = new Map<string, string>();
  private readonly rewinds = new Set<string>();
  private readonly bases = new ChunkedList<ChatTimelineItem>((item) => item.key);
  private readonly finals = new ChunkedList<ChatTimelineItem>((item) => item.key);
  private readonly rowKeys = new Map<string, string>();
  private bodyCount = 0;
  private readonly carried = new Map<string, string | undefined>();
  private work: LiveWork | null = null;
  private tailSlots: readonly ChatTailSlot[] = [];
  private newest: string | null = null;
  private applied: { hostKey: string | null; railed: number } = { hostKey: null, railed: 0 };
  private appendixPlan = '';
  private readonly stale = new Set<string>();
  private liveStructural = false;
  private readonly livePatched = new Set<string>();
  private retryHeld: number | null = null;
  private previous: ReadonlyMap<string, ChatTimelineItem> | null = null;

  constructor(private readonly kinds: EntryKinds) {}

  get count(): number {
    return this.finals.length;
  }

  get newestKey(): string | null {
    return this.newest;
  }

  keyAt(index: number): string | undefined {
    return this.finals.at(index)?.key;
  }

  itemAt(index: number): ChatTimelineItem | undefined {
    return this.finals.at(index);
  }

  item(key: string): ChatTimelineItem | undefined {
    return this.finals.get(key);
  }

  indexOf(key: string): number {
    return this.finals.indexOf(key);
  }

  rowOf(entryId: string): string | undefined {
    return this.rowKeys.get(entryId);
  }

  slice(): readonly ChatTimelineItem[] {
    return this.finals.slice();
  }

  sync(feed: VisibleFeed, view: ChatRowView, work: LiveWork | null, tail: readonly ChatTailSlot[]): void {
    const stamp = this.kinds.stamp();
    const was = this.work?.runId ?? null;
    this.work = work;
    this.tailSlots = tail;
    if (was !== (work?.runId ?? null)) {
      this.restaleRun(was);
      this.restaleRun(work?.runId ?? null);
    }
    if (this.seen < 0 || this.origin !== feed || this.stamp !== stamp || this.view !== view) {
      this.restart(view, stamp, feed);
      return;
    }
    if (feed.revision !== this.seen) {
      const deltas = feed.since(this.seen);
      if (deltas === null) {
        this.restart(view, stamp, feed);
        return;
      }
      for (const delta of deltas) this.take(delta.rows, delta.live);
      this.seen = feed.revision;
    }
    this.settle();
  }

  load(entries: readonly ChatEntry[], view: ChatRowView = UNTOUCHED, live: ChatLiveWork | null = null): void {
    const standing = new Set((live?.entries ?? []).map((entry) => entry.id));
    this.work = live === null ? null : { runId: live.runId, status: live.status };
    this.tailSlots = [];
    this.origin = null;
    this.seen = -1;
    this.begin(
      view,
      this.kinds.stamp(),
      entries.filter((entry) => !standing.has(entry.id)),
      live?.entries ?? [],
    );
  }

  private restart(view: ChatRowView, stamp: number, feed: VisibleFeed): void {
    const shown = feed.snapshot();
    this.begin(view, stamp, shown.rows, shown.live);
    this.origin = feed;
    this.seen = feed.revision;
  }

  private begin(view: ChatRowView, stamp: number, rows: readonly ChatEntry[], live: readonly ActivityEntry[]): void {
    const heldItems = this.finals.slice();
    const heldRevision = this.revision;
    const heldShape = this.shape;
    this.previous = new Map(heldItems.map((item) => [item.key, item]));
    this.view = view;
    this.stamp = stamp;
    this.sizing = new ViewSizing(view, this.heights);
    this.input.clear();
    this.input.splice(0, 0, rows);
    this.liveInput.clear();
    this.liveInput.splice(0, 0, live);
    this.table.clear();
    this.ownerOf.clear();
    this.rewinds.clear();
    this.bases.clear();
    this.finals.clear();
    this.rowKeys.clear();
    this.stale.clear();
    this.livePatched.clear();
    this.liveStructural = false;
    this.retryHeld = null;
    this.bodyCount = 0;
    this.carried.clear();
    this.newest = null;
    this.applied = { hostKey: null, railed: 0 };
    this.appendixPlan = '';
    const segments = segmentsOf(this.kinds, rows, true);
    this.newest = segments.findLast((segment) => segment.kind === 'activity')?.group.key ?? null;
    this.replaceSegments(0, -1, 0, this.input.length, this.input.length, segments);
    this.settle();
    this.previous = null;
    const now = this.finals.slice();
    if (now.length === heldItems.length && now.every((item, index) => item === heldItems[index])) {
      this.revision = heldRevision;
      this.shape = heldShape;
      return;
    }
    this.shape =
      now.length === heldItems.length && now.every((item, index) => item.key === heldItems[index]!.key) ? heldShape : heldShape + 1;
    this.revision = heldRevision + 1;
  }

  private take(rows: readonly FeedChange<ChatEntry>[], live: readonly FeedChange<ActivityEntry>[]): void {
    for (const change of rows) this.local(change);
    for (const change of live) this.takeLive(change);
  }

  private takeLive(change: FeedChange<ActivityEntry>): void {
    if (change.kind === 'patch') {
      const held = this.liveInput.set(change.at, change.item);
      if (held.kind !== change.item.kind) this.liveStructural = true;
      else this.livePatched.add(change.item.id);
      if (held.kind !== change.item.kind || change.item.kind === 'retry') this.retryHeld = null;
    } else {
      this.liveInput.splice(change.from, change.removed.length, change.inserted);
      this.liveStructural = true;
      this.retryHeld = null;
    }
  }

  private local(change: FeedChange<ChatEntry>): void {
    const input = this.input;
    const from = change.kind === 'patch' ? change.at : change.from;
    const removed: readonly ChatEntry[] = change.kind === 'patch' ? [input.at(from)!] : change.removed;
    const inserted: readonly ChatEntry[] = change.kind === 'patch' ? [change.item] : change.inserted;
    const owner = removed[0] === undefined ? -1 : this.ownerIndex(removed[0]);
    const within = change.kind === 'patch' && owner >= 0 && groupOf(this.kinds, removed[0]!) === groupOf(this.kinds, inserted[0]!);
    const gone = new Set(removed.map(idOf));
    const runs = runsOf(within ? new Set([owner]) : this.affected(from, removed, inserted, gone)).map(([first, last]) => ({
      first,
      last,
      ...this.extent(first, last, gone),
    }));
    const edge = from + removed.length;
    const shift = inserted.length - removed.length;
    const moved = (at: number): number => (at >= edge ? at + shift : at);
    const movedStart = (at: number): number => (removed.length === 0 && at === from ? at : moved(at));
    if (change.kind === 'patch') input.set(from, change.item);
    else input.splice(from, removed.length, inserted);
    if (runs.length === 0) {
      const end = from + inserted.length;
      this.replaceSegments(this.table.length, this.table.length - 1, from, end, end);
      return;
    }
    const joined = new Set(inserted.flatMap((entry) => (entry.rewound === undefined ? [] : [rewindKey(entry.rewound.by)])));
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index]!;
      const reaches = joined.size > 0 && this.table.slice(run.first, run.last + 1).some((seg) => joined.has(seg.key));
      const stop = reaches ? Math.max(moved(run.stop), from + inserted.length) : moved(run.stop);
      this.replaceSegments(run.first, run.last, movedStart(run.start), moved(run.end), stop);
    }
  }

  private affected(from: number, removed: readonly ChatEntry[], inserted: readonly ChatEntry[], gone: ReadonlySet<string>): Set<number> {
    const wanted = new Set<number>();
    const add = (at: number) => {
      if (at >= 0 && at < this.table.length) wanted.add(at);
    };
    for (const entry of removed) {
      const owner = this.ownerIndex(entry);
      if (owner < 0) continue;
      add(owner - 1);
      add(owner);
      add(owner + 1);
    }
    if (inserted.length > 0) {
      const gap = this.segBefore(from);
      add(gap);
      add(gap + 1);
    }
    const keys = new Set<string>();
    for (const entry of [...removed, ...inserted]) if (entry.rewound !== undefined) keys.add(rewindKey(entry.rewound.by));
    for (const key of keys) {
      const at = this.table.indexOf(key);
      if (at < 0) continue;
      add(at - 1);
      add(at);
      add(at + 1);
      const seg = this.table.at(at)!;
      let leading = inserted.some((entry) => rewindKey(entry.rewound?.by ?? '') === key) ? from : Number.POSITIVE_INFINITY;
      for (const id of seg.ids) {
        if (gone.has(id)) continue;
        leading = Math.min(leading, this.input.indexOf(id));
        break;
      }
      if (leading === this.anchorIdx(at)) continue;
      const target = Number.isFinite(leading) ? this.segBefore(leading) : at;
      for (let between = Math.min(at, target); between <= Math.max(at, target) + 1; between += 1) add(between);
    }
    return wanted;
  }

  private anchorIdx(at: number): number {
    return this.input.indexOf(this.table.at(at)!.firstId);
  }

  private segBefore(index: number): number {
    let low = -1;
    let high = this.table.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.anchorIdx(middle) < index) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  private extent(first: number, last: number, gone: ReadonlySet<string>): { start: number; end: number; stop: number } {
    const start = first === 0 ? 0 : this.anchorIdx(first);
    const end = last + 1 < this.table.length ? this.anchorIdx(last + 1) : this.input.length;
    let stop = end;
    for (let at = first; at <= last; at += 1) {
      const seg = this.table.at(at)!;
      if (seg.kind !== 'rewind') continue;
      for (let index = seg.ids.length - 1; index >= 0; index -= 1) {
        if (gone.has(seg.ids[index]!)) continue;
        const found = this.input.indexOf(seg.ids[index]!);
        if (found < 0) continue;
        stop = Math.max(stop, found + 1);
        break;
      }
    }
    return { start, end, stop };
  }

  private entriesOf(first: number, last: number, start: number, end: number, stop: number): ChatEntry[] {
    const slice = this.input.slice(start, stop);
    if (this.rewinds.size === 0 && !marked(slice)) return slice;
    return slice.filter((entry, offset) => {
      const owner = this.ownerIndex(entry);
      const inRange = owner >= first && owner <= last;
      if (start + offset >= end) return entry.rewound !== undefined && inRange;
      return entry.rewound === undefined || owner < 0 || inRange;
    });
  }

  private ownerIndex(entry: ChatEntry): number {
    const key = entry.rewound === undefined ? this.ownerOf.get(entry.id) : rewindKey(entry.rewound.by);
    return key === undefined ? -1 : this.table.indexOf(key);
  }

  private replaceSegments(first: number, last: number, start: number, end: number, stop: number, made?: Segment[]): void {
    const old = last >= first ? this.table.slice(first, last + 1) : [];
    const segments = made ?? segmentsOf(this.kinds, this.entriesOf(first, last, start, end, stop), true);
    let removedItems = 0;
    for (const seg of old) {
      removedItems += seg.items;
      for (const id of seg.ids) this.ownerOf.delete(id);
      this.rewinds.delete(seg.key);
    }
    const itemFrom =
      old.length > 0
        ? this.finals.indexOf(old[0]!.firstItem)
        : first < this.table.length
          ? this.finals.indexOf(this.table.at(first)!.firstItem)
          : this.bodyCount;
    const emitted = segments.map((segment) => this.emit(segment));
    const bases = emitted.flatMap((made) => made.bases);
    this.bodyCount += bases.length - removedItems;
    this.replaceItems(itemFrom, removedItems, bases);
    this.table.splice(
      first,
      old.length,
      emitted.map((made) => made.seg),
    );
    for (const { seg } of emitted) {
      for (const id of seg.ids) this.ownerOf.set(id, seg.key);
      if (seg.kind === 'rewind') this.rewinds.add(seg.key);
    }
    this.followNewest(
      first,
      emitted.map((made) => made.seg),
    );
  }

  private followNewest(first: number, made: readonly Seg[]): void {
    const held = this.newest;
    const heldAt = held === null ? -1 : this.table.indexOf(held);
    const fresh = made.findLast((seg) => seg.kind === 'activity')?.key ?? null;
    let next: string | null;
    if (heldAt >= first + made.length) next = held;
    else if (fresh !== null) next = fresh;
    else if (heldAt >= 0) next = held;
    else next = held === null ? null : this.activityBefore(first);
    if (next === held) return;
    this.newest = next;
    if (held !== null) this.stale.add(held);
    if (next !== null) this.stale.add(next);
  }

  private restaleRun(runId: string | null): void {
    if (runId === null) return;
    this.table.eachBack((seg) => {
      if (seg.kind !== 'activity' || seg.runId === undefined) return true;
      if (seg.runId !== runId) return false;
      this.stale.add(seg.key);
      return true;
    });
  }

  private activityBefore(index: number): string | null {
    let found: string | null = null;
    this.table.eachBack((seg, at) => {
      if (at >= index) return true;
      if (seg.kind !== 'activity') return true;
      found = seg.key;
      return false;
    });
    return found;
  }

  private emit(segment: Segment): Emitted {
    const bases: ChatTimelineItem[] = [];
    const lines = this.place(segment, bases);
    const ids =
      segment.kind === 'entry'
        ? [segment.entry.id]
        : segment.kind === 'activity'
          ? segment.group.entries.map((entry) => entry.id)
          : segment.entries.map((entry) => entry.id);
    const key = segment.kind === 'entry' ? segment.entry.id : segment.kind === 'activity' ? segment.group.key : rewindKey(segment.by);
    return {
      bases,
      seg: {
        key,
        kind: segment.kind,
        firstId: ids[0]!,
        ids,
        items: bases.length,
        firstItem: bases[0]!.key,
        lines,
        runId: segment.kind === 'activity' ? segment.group.entries[0]?.runId : undefined,
      },
    };
  }

  private place(segment: Segment, out: ChatTimelineItem[]): number {
    const view = this.sizing;
    const put = (item: Unspaced) => out.push({ ...item, spaced: true } as Placed);
    if (segment.kind === 'rewind') {
      const key = rewindKey(segment.by);
      const open = view.expanded(key, false);
      put({
        kind: 'rewind',
        key,
        rewind: segment.by,
        scope: segment.scope,
        turns: new Set(segment.entries.flatMap((entry) => (entry.runId === undefined ? [] : [entry.runId]))).size,
        words: firstLabelLine(segment.entries.find((entry) => entry.kind === 'user')?.text ?? ''),
        open,
        estimate: rewindEstimate(segment.scope),
        occurredAt: segment.entries.find((entry) => entry.occurredAt)?.occurredAt,
      });
      if (open) for (const inner of segmentsOf(this.kinds, segment.entries, false)) this.place(inner, out);
      return 0;
    }
    if (segment.kind === 'entry') {
      put({
        kind: 'entry',
        key: segment.entry.id,
        entry: segment.entry,
        estimate: this.kinds.estimate(segment.entry, view),
        open: view.expanded(segment.entry.id, false),
        keepAlive: this.kinds.keepsAlive(segment.entry) ? (true as const) : undefined,
      });
      return 0;
    }
    const group = segment.group;
    const rows = activityRows(group.entries, {
      keepsAlive: (entry) => this.kinds.keepsAlive(entry),
      growing: this.work !== null && group.entries[0]?.runId === this.work.runId,
    });
    const thoughts = activityThoughtsOnly(rows);
    const lone = group.entries.length === 1 || (rows.length === 1 && rows[0]!.kind === 'notices');
    const stretchOpen = view.stretchDefault(group.key, group.key === this.newest);
    const shown = view.expanded(group.key, stretchOpen);
    if (!lone) put({ kind: 'stretch', key: group.key, group, thoughts, estimate: stretchEstimate(group), open: shown });
    if (!lone && !shown) return 0;
    const lines: readonly ActivityRow[] = thoughts
      ? (rows[0] as Extract<ActivityRow, { kind: 'thoughts' }>).entries.map((entry) => ({ kind: 'step' as const, key: entry.id, entry }))
      : rows;
    const joined = group.key === this.applied.hostKey ? this.applied.railed : 0;
    lines.forEach((row, index) => {
      put({
        kind: 'step',
        key: row.key,
        stretch: group.key,
        row,
        place: railPlace(index, lines.length + joined),
        bare: thoughts,
        estimate: stepEstimate(row, stretchOpen, view),
        open: rowOpen(row, stretchOpen, view),
        keepAlive: row.kind === 'step' && this.kinds.keepsAlive(row.entry) ? (true as const) : undefined,
      });
    });
    return lines.length;
  }

  private replaceItems(from: number, removed: number, inserted: readonly ChatTimelineItem[]): void {
    const gone = this.finals.slice(from, from + removed);
    const sameKeys = gone.length === inserted.length && gone.every((item, index) => item.key === inserted[index]!.key);
    const known = new Map(gone.map((item) => [item.key, item]));
    this.bases.splice(from, removed, inserted);
    const made = inserted.map((base, index) => this.finalize(from + index, known.get(base.key)));
    this.finals.splice(from, removed, made);
    for (const item of gone) {
      this.forget(item);
      const standing = this.finals.get(item.key);
      if (standing !== undefined) this.remember(standing);
      else this.carried.delete(item.key);
    }
    for (const item of made) this.remember(item);
    const before = this.finals.at(from - 1);
    if (before !== undefined) this.refinalize(from - 1, before);
    for (let at = from + inserted.length; at < this.finals.length; at += 1) {
      const held = this.finals.at(at)!;
      const carried = this.carried.get(held.key);
      this.refinalize(at, held);
      if (this.carried.get(held.key) === carried) break;
    }
    if (!sameKeys) this.shape += 1;
    this.revision += 1;
  }

  private refinalize(index: number, held: ChatTimelineItem): void {
    const next = this.finalize(index, held);
    if (next !== held) this.finals.set(index, next);
  }

  private finalize(index: number, reuse: ChatTimelineItem | undefined): ChatTimelineItem {
    const base = this.bases.at(index)!;
    if (base.kind === 'tail') return base;
    let item: Placed = base;
    if (index < this.bodyCount && base.kind !== 'status') {
      const at = itemOccurredAt(base);
      const day = at === undefined ? undefined : localDayKey(at);
      const inherited = index === 0 ? undefined : this.carried.get(this.bases.at(index - 1)!.key);
      this.carried.set(base.key, day ?? inherited);
      if (at !== undefined && day !== inherited) {
        item = { ...base, dayBefore: at, estimate: base.estimate + DAY_BOUNDARY_PX } as Placed;
      }
    }
    const made = spaced(item, this.bases.at(index + 1));
    const held = reuse ?? this.previous?.get(made.key);
    return held !== undefined && sameTimelineItem(held, made) ? held : made;
  }

  private forget(item: ChatTimelineItem): void {
    for (const id of rowEntryIds(item)) if (this.rowKeys.get(id) === item.key) this.rowKeys.delete(id);
  }

  private remember(item: ChatTimelineItem): void {
    for (const id of rowEntryIds(item)) this.rowKeys.set(id, item.key);
  }

  private settle(): void {
    const railed = this.railedNow();
    const last = this.table.at(this.table.length - 1);
    const hostKey = this.work !== null && railed > 0 && last?.kind === 'activity' && last.runId === this.work.runId ? last.key : null;
    if (hostKey !== this.applied.hostKey || railed !== this.applied.railed) {
      if (this.applied.hostKey !== null) this.stale.add(this.applied.hostKey);
      if (hostKey !== null) this.stale.add(hostKey);
      this.applied = { hostKey, railed };
    }
    while (this.stale.size > 0) {
      const [key] = this.stale;
      this.stale.delete(key!);
      this.reemit(key!);
    }
    this.settleAppendix();
  }

  private reemit(key: string): void {
    const at = this.table.indexOf(key);
    if (at < 0) return;
    const { start, end, stop } = this.extent(at, at, new Set());
    this.replaceSegments(at, at, start, end, stop);
  }

  private railedNow(): number {
    const work = this.work;
    if (work === null) return 0;
    const retryAt = this.retryAt();
    return retryAt === -1 ? this.liveInput.length + (work.status ? 1 : 0) : retryAt;
  }

  private retryAt(): number {
    if (this.retryHeld !== null) return this.retryHeld;
    let found = -1;
    let index = 0;
    for (const entry of this.liveInput) {
      if (entry.kind === 'retry') {
        found = index;
        break;
      }
      index += 1;
    }
    this.retryHeld = found;
    return found;
  }

  private settleAppendix(): void {
    const work = this.work;
    const host = this.applied.hostKey === null ? undefined : this.table.get(this.applied.hostKey);
    const plan = `${work === null ? '-' : `${work.runId}:${work.status}`}|${this.applied.railed}|${this.applied.hostKey ?? ''}|${host?.lines ?? 0}|${this.tailSlots.join(',')}`;
    if (this.liveStructural || plan !== this.appendixPlan) {
      this.appendixPlan = plan;
      this.liveStructural = false;
      this.livePatched.clear();
      this.rebuildAppendix(host?.lines ?? 0);
      return;
    }
    if (this.livePatched.size === 0) return;
    const hostLines = host?.lines ?? 0;
    for (const id of this.livePatched) {
      const index = this.liveInput.indexOf(id);
      if (index < 0) continue;
      const at = this.bodyCount + index;
      const base = this.liveBase(this.liveInput.at(index)!, index, hostLines);
      if (!sameTimelineItem(this.bases.at(at)!, base)) this.replaceItems(at, 1, [base]);
    }
    this.livePatched.clear();
  }

  private rebuildAppendix(hostLines: number): void {
    const next: ChatTimelineItem[] = [];
    for (const [index, entry] of [...this.liveInput].entries()) next.push(this.liveBase(entry, index, hostLines));
    if (this.work?.status) {
      next.push({
        kind: 'status',
        key: LIVE_STATUS_KEY,
        ...this.railAt(this.liveInput.length, hostLines),
        spaced: true,
        estimate: liveStatusEstimate(),
      });
    }
    for (const slot of this.tailSlots) next.push(CHAT_TAIL_ITEMS[slot]);
    const old = this.bases.slice(this.bodyCount);
    let head = 0;
    while (head < old.length && head < next.length && sameTimelineItem(old[head]!, next[head]!)) head += 1;
    let tail = 0;
    while (
      tail < old.length - head &&
      tail < next.length - head &&
      sameTimelineItem(old[old.length - 1 - tail]!, next[next.length - 1 - tail]!)
    ) {
      tail += 1;
    }
    const removed = old.length - head - tail;
    const inserted = next.slice(head, next.length - tail);
    if (removed === 0 && inserted.length === 0) return;
    this.replaceItems(this.bodyCount + head, removed, inserted);
  }

  private railAt(index: number, hostLines: number): { stretch: string; place: ReturnType<typeof railPlace> } {
    const { railed, hostKey } = this.applied;
    return index < railed
      ? { stretch: hostKey ?? '', place: railPlace(hostLines + index, hostLines + railed) }
      : { stretch: '', place: 'only' };
  }

  private liveBase(entry: ActivityEntry, index: number, hostLines: number): ChatTimelineItem {
    const row: ActivityRow = { kind: 'step', key: entry.id, entry };
    return {
      kind: 'step',
      key: entry.id,
      ...this.railAt(index, hostLines),
      row,
      bare: false,
      live: true,
      spaced: true,
      estimate: stepEstimate(row, true, this.sizing),
      open: rowOpen(row, true, this.sizing),
      keepAlive: this.kinds.keepsAlive(entry) ? (true as const) : undefined,
    };
  }
}

export function chatTimeline(
  kinds: EntryKinds,
  entries: readonly ChatEntry[],
  view?: ChatRowView,
  live: ChatLiveWork | null = null,
): readonly Placed[] {
  const fold = new TimelineFold(kinds);
  fold.load(entries, view, live);
  return fold.slice() as readonly Placed[];
}

function spaced(item: Placed, next: ChatTimelineItem | undefined): Placed {
  if (continuedBy(item, next)) return { ...item, spaced: false };
  return { ...item, estimate: item.estimate + FEED_GAP_PX };
}

function continuedBy(item: Placed, next: ChatTimelineItem | undefined): boolean {
  if (next?.kind !== 'step' && next?.kind !== 'status') return false;
  if (item.kind === 'stretch') return next.stretch === item.key;
  return next.place === 'middle' || next.place === 'last';
}
