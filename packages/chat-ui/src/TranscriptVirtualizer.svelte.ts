import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type Range,
  type Rect,
  Virtualizer,
  type VirtualItem,
} from '@tanstack/virtual-core';
import { flushSync } from 'svelte';
import type { FeedMemory } from './FeedMemory';
import type { ChatTimelineItem, RowModel } from './timeline';

const ESTIMATED_ROW_PX = 60;
const OVERSCAN_ROWS = 20;
const OPENING_OVERSCAN_ROWS = 6;
export const TRANSCRIPT_END_THRESHOLD_PX = 80;
const ROW_LANDING_GAP_PX = 12;
const PREPEND_SETTLE_PX = 0.5;
const PREPEND_STABLE_FRAMES = 30;
const PREPEND_MAX_FRAMES = 180;
export const KEEP_ALIVE_ROWS = 4;
const NO_KEYS: readonly string[] = [];
const EMPTY_ROWS: RowModel = {
  revision: 0,
  shape: 0,
  count: 0,
  keyAt: () => undefined,
  itemAt: () => undefined,
  item: () => undefined,
  indexOf: () => -1,
};

type Stamp = { readonly width: number; readonly open: boolean };
type LiveRow = { key: string; seen: number; index: number };

export class TranscriptVirtualizer {
  rows = $state.raw<readonly VirtualItem[]>([]);
  totalSize = $state(0);
  visibleKeys = $state.raw<readonly string[]>([]);
  heldKeys = $state.raw<ReadonlySet<string>>(new Set());
  margin = $state(0);

  private virtualizer: Virtualizer<HTMLElement, HTMLElement> | undefined;
  private anchoredBottom: () => boolean = () => true;
  private clearance = 0;
  private readonly gesturing: () => boolean;
  private overscan = OPENING_OVERSCAN_ROWS;
  private widening: number | undefined;
  private pinned: readonly number[] = [];
  private pinning: number | undefined;
  private release: (() => void) | undefined;
  private root: HTMLElement | undefined;
  private list: HTMLElement | undefined;
  private threadKey: string | null = null;
  private rows_: RowModel = EMPTY_ROWS;
  private shape: number | null = null;
  private readonly alive = new Map<string, { seen: number; index: number }>();
  private seenTick = 0;
  private held: readonly string[] = NO_KEYS;
  private readonly stamps = new Map<string, Stamp>();
  private width = 0;
  private stampedWidth = 0;
  private stampedDisclosure = -1;
  private itemKey = (index: number): string | number => this.rows_.keyAt(index) ?? index;

  private aim: { key: string; index: number; behavior: ScrollBehavior } | undefined;
  private prependAnchor: { key: string; offset: number } | undefined;
  private prependFrame: number | undefined;
  private prependLoading = false;
  private readonly remeasuring = new Map<string, number>();
  private measuring = false;
  private flushing = false;
  private chasing = false;

  constructor(
    private readonly memory: FeedMemory,
    options: { gesturing?: () => boolean } = {},
  ) {
    this.gesturing = options.gesturing ?? (() => false);
  }

  openThread(key: string | null): void {
    if (key === this.threadKey) return;
    this.remember();
    this.threadKey = key;
    this.dropVirtualizer();
  }

  sync(input: {
    root: HTMLElement | undefined;
    list: HTMLElement | undefined;
    model: RowModel;
    shape: number;
    atBottom: () => boolean;
    clearance: number;
    disclosure: number;
  }): void {
    this.rows_ = input.model;
    const reshaped = input.shape !== this.shape;
    if (reshaped) {
      this.shape = input.shape;
      this.itemKey = (index) => this.rows_.keyAt(index) ?? index;
    }
    this.anchoredBottom = input.atBottom;
    this.clearance = input.clearance;
    const rebuilt = input.root !== this.root;
    if (rebuilt) {
      this.remember();
      this.root = input.root;
    }
    const bound = input.list !== this.list;
    this.list = input.list;
    if (rebuilt || bound) this.measureMargin();
    if (!input.root) {
      this.dropVirtualizer();
      return;
    }
    let virtualizer = this.virtualizer;
    let remeasure: boolean;
    if (rebuilt || !virtualizer) {
      virtualizer = this.build(input.root, input.disclosure);
      remeasure = true;
    } else {
      remeasure = this.reconcile(virtualizer, input.disclosure);
      virtualizer.setOptions(this.options());
    }
    virtualizer._willUpdate();
    this.publish();
    if (remeasure) this.measureMounted();
    if (reshaped) this.reaim(virtualizer);
    if (reshaped && this.chasing && this.anchoredBottom() && !this.gesturing()) this.anchorEnd();
  }

  private build(root: HTMLElement, disclosure: number): Virtualizer<HTMLElement, HTMLElement> {
    this.dropVirtualizer();
    this.overscan = OPENING_OVERSCAN_ROWS;
    this.width = root.clientWidth;
    const virtualizer = new Virtualizer({ ...this.options(), initialMeasurementsCache: this.rememberedRows() });
    this.virtualizer = virtualizer;
    this.stampedDisclosure = disclosure;
    virtualizer.indexFromElement = (node) => this.rows_.indexOf(node.dataset.timelineKey ?? '');
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
      if (this.anchoredBottom()) return false;
      const first = virtualizer.range?.startIndex;
      return first !== undefined && item.index < first;
    };
    this.pinResizedRows(virtualizer);
    this.release = virtualizer._didMount();
    this.widen();
    return virtualizer;
  }

  remeasure(): void {
    const previous = this.margin;
    this.measureMargin();
    if (this.margin === previous || !this.virtualizer) return;
    this.virtualizer.setOptions(this.options());
    this.virtualizer._willUpdate();
    this.publish();
  }

  measureRow(node: HTMLElement): void {
    this.measuring = true;
    try {
      this.virtualizer?.measureElement(node);
    } finally {
      this.measuring = false;
    }
  }

  measureRowLater(key: string): void {
    if (typeof requestAnimationFrame !== 'function') return;
    const pending = this.remeasuring.get(key);
    if (pending !== undefined) cancelAnimationFrame(pending);
    this.remeasuring.set(
      key,
      requestAnimationFrame(() => {
        this.remeasuring.delete(key);
        const row = this.rowNode(key);
        if (row?.isConnected) this.measureRow(row);
      }),
    );
  }

  holds(key: string): boolean {
    return this.virtualizer !== undefined && this.rows_.indexOf(key) >= 0;
  }

  scrollToRow(key: string, behavior: ScrollBehavior): void {
    const index = this.rows_.indexOf(key);
    if (index < 0) return;
    this.dropPrepend();
    this.chasing = false;
    this.aim = { key, index, behavior };
    this.virtualizer?.scrollToIndex(index, { align: 'start', behavior });
  }

  letGo(): void {
    this.aim = undefined;
  }

  private reaim(virtualizer: Virtualizer<HTMLElement, HTMLElement>): void {
    const aim = this.aim;
    if (aim === undefined) return;
    const index = this.rows_.indexOf(aim.key);
    if (index < 0) {
      this.aim = undefined;
      return;
    }
    if (index === aim.index) return;
    aim.index = index;
    virtualizer.scrollToIndex(index, { align: 'start', behavior: aim.behavior });
  }

  rowAt(offset: number): number | undefined {
    return this.virtualizer?.getVirtualItemForOffset(offset)?.index;
  }

  rowOf(key: string): number {
    return this.rows_.indexOf(key);
  }

  holdPrepend(): void {
    this.prependLoading = true;
    this.capturePrepend();
  }

  trackPrepend(): void {
    if (!this.prependLoading) return;
    this.capturePrepend();
  }

  releasePrepend(): void {
    this.prependLoading = false;
    this.applyPrepend();
  }

  clearPrepend(): void {
    if (this.prependLoading) return;
    this.dropPrepend();
  }

  anchorEnd(): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer || this.rows_.count === 0) return;
    if (this.pinning !== undefined) cancelAnimationFrame(this.pinning);
    this.pinning = undefined;
    this.pinned = [];
    this.aim = undefined;
    this.dropPrepend();
    if (this.list) this.list.style.height = `${virtualizer.getTotalSize()}px`;
    virtualizer.scrollToEnd();
    this.chasing = true;
  }

  private dropPrepend(): void {
    this.prependLoading = false;
    this.prependAnchor = undefined;
    if (this.prependFrame === undefined) return;
    cancelAnimationFrame(this.prependFrame);
    this.prependFrame = undefined;
  }

  dispose(): void {
    this.remember();
    this.dropVirtualizer();
  }

  private capturePrepend(): void {
    const root = this.root;
    if (!root || this.aim !== undefined) return;
    const view = root.getBoundingClientRect();
    const rows = this.rowNodes()
      .map((element) => ({ key: element.dataset.timelineKey, rect: element.getBoundingClientRect() }))
      .filter((row) => row.key && row.rect.bottom > view.top && row.rect.top < view.bottom)
      .sort((left, right) => left.rect.top - right.rect.top);
    const anchor = rows[0];
    if (!anchor?.key) return;
    this.prependAnchor = { key: anchor.key, offset: anchor.rect.top - view.top };
  }

  private applyPrepend(): void {
    const root = this.root;
    if (!root || !this.prependAnchor) return;
    if (this.prependFrame !== undefined) cancelAnimationFrame(this.prependFrame);
    let frames = 0;
    let stable = 0;
    const apply = () => {
      this.prependFrame = undefined;
      const anchor = this.prependAnchor;
      if (!anchor) return;
      const element = this.rowNode(anchor.key);
      const delta = element ? element.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset : undefined;
      if (delta !== undefined && Math.abs(delta) > PREPEND_SETTLE_PX) {
        root.scrollTop += delta;
        stable = 0;
      } else {
        stable += 1;
      }
      frames += 1;
      if (stable >= PREPEND_STABLE_FRAMES || frames >= PREPEND_MAX_FRAMES) {
        if (!this.prependLoading) this.prependAnchor = undefined;
        return;
      }
      this.prependFrame = requestAnimationFrame(apply);
    };
    this.prependFrame = requestAnimationFrame(apply);
  }

  private pinResizedRows(virtualizer: Virtualizer<HTMLElement, HTMLElement>): void {
    const resize = virtualizer.resizeItem;
    virtualizer.resizeItem = (index: number, size: number) => {
      const root = this.root;
      const item = virtualizer.measurementsCache[index];
      const held = item ? (virtualizer.itemSizeCache.get(item.key) ?? item.size) : undefined;
      if (root && held !== undefined && Math.abs(size - held) > root.clientHeight) {
        this.pinned = this.rows.map((row) => row.index);
        if (this.pinning !== undefined) cancelAnimationFrame(this.pinning);
        this.pinning = requestAnimationFrame(() => {
          this.pinning = requestAnimationFrame(() => {
            this.pinning = undefined;
            this.pinned = [];
          });
        });
      }
      virtualizer.options.scrollEndThreshold = this.anchoredBottom() ? TRANSCRIPT_END_THRESHOLD_PX : Number.NEGATIVE_INFINITY;
      const row = this.rows_.itemAt(index);
      if (row !== undefined) this.stamps.set(row.key, { width: this.width, open: row.open ?? false });
      resize(index, size);
      if (this.anchoredBottom()) this.reanchorEnd();
    };
  }

  private reanchoring = false;

  private reanchorEnd(): void {
    if (this.reanchoring || this.gesturing()) return;
    this.reanchoring = true;
    queueMicrotask(() => {
      this.reanchoring = false;
      if (!this.anchoredBottom() || this.gesturing()) return;
      this.anchorEnd();
    });
  }

  private widen(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.overscan = OVERSCAN_ROWS;
      return;
    }
    if (this.widening !== undefined) cancelAnimationFrame(this.widening);
    this.widening = requestAnimationFrame(() => {
      this.widening = undefined;
      if (!this.virtualizer || this.overscan === OVERSCAN_ROWS) return;
      this.overscan = OVERSCAN_ROWS;
      this.virtualizer.setOptions(this.options());
      if (this.anchoredBottom() && !this.gesturing()) this.anchorEnd();
      this.virtualizer._willUpdate();
      this.publish();
    });
  }

  private options() {
    const model = this.rows_;
    return {
      count: model.count,
      getScrollElement: () => this.root ?? null,
      estimateSize: (index: number) => model.itemAt(index)?.estimate ?? ESTIMATED_ROW_PX,
      getItemKey: this.itemKey,
      overscan: this.overscan,
      rangeExtractor: (range: Range) => {
        const window = defaultRangeExtractor({ ...range, overscan: this.overscan });
        const mounted =
          this.pinned.length === 0
            ? window
            : [...new Set([...this.pinned, ...window])]
                .filter((index) => index >= 0 && index < range.count)
                .sort((left, right) => left - right);
        return this.withLiveRows(mounted);
      },
      scrollMargin: this.margin,
      scrollPaddingStart: ROW_LANDING_GAP_PX,
      paddingEnd: this.clearance,
      anchorTo: 'end' as const,
      followOnAppend: this.anchoredBottom(),
      scrollEndThreshold: this.anchoredBottom() ? TRANSCRIPT_END_THRESHOLD_PX : Number.NEGATIVE_INFINITY,
      initialOffset: () => (this.anchoredBottom() ? Number.MAX_SAFE_INTEGER : 0),
      scrollToFn: (
        offset: number,
        options: { adjustments?: number; behavior?: ScrollBehavior },
        instance: Virtualizer<HTMLElement, HTMLElement>,
      ) => {
        if (this.list) this.list.style.height = `${instance.getTotalSize()}px`;
        if (this.chasing && options.behavior !== undefined && (!this.anchoredBottom() || this.gesturing())) return;
        elementScroll(offset, options, instance);
      },
      observeElementRect: (instance: Virtualizer<HTMLElement, HTMLElement>, changed: (rect: Rect) => void) =>
        observeElementRect(instance, (rect) => {
          this.width = this.root?.clientWidth ?? 0;
          changed(rect);
        }),
      observeElementOffset,
      onChange: (_instance: Virtualizer<HTMLElement, HTMLElement>, sync: boolean) => this.publish(sync),
    };
  }

  private withLiveRows(mounted: number[]): number[] {
    this.seenTick += 1;
    for (const index of mounted) {
      const item = this.rows_.itemAt(index);
      if (item?.keepAlive !== true) continue;
      const known = this.alive.get(item.key);
      if (known === undefined) this.alive.set(item.key, { seen: this.seenTick, index });
      else {
        known.seen = this.seenTick;
        known.index = index;
      }
    }
    if (this.alive.size === 0) {
      this.held = NO_KEYS;
      return mounted;
    }
    let outside: LiveRow[] | undefined;
    for (const [key, known] of this.alive) {
      const index = this.liveRowAt(key, known.index);
      if (index === undefined) {
        this.alive.delete(key);
        continue;
      }
      known.index = index;
      if (!includes(mounted, index)) (outside ??= []).push({ key, seen: known.seen, index });
    }
    if (outside === undefined) {
      this.held = NO_KEYS;
      return mounted;
    }
    if (outside.length > KEEP_ALIVE_ROWS) {
      outside.sort((left, right) => right.seen - left.seen);
      for (const gone of outside.splice(KEEP_ALIVE_ROWS)) this.alive.delete(gone.key);
    }
    this.held = outside.map((row) => row.key);
    return merged(
      mounted,
      outside.map((row) => row.index).sort((left, right) => left - right),
    );
  }

  private liveRowAt(key: string, hint: number): number | undefined {
    const hinted = this.rows_.itemAt(hint);
    if (hinted?.key === key) return hinted.keepAlive === true ? hint : undefined;
    const found = this.rows_.indexOf(key);
    return found >= 0 && this.rows_.itemAt(found)!.keepAlive === true ? found : undefined;
  }

  private itemAt(key: string): ChatTimelineItem | undefined {
    const index = this.rows_.indexOf(key);
    return index < 0 ? undefined : this.rows_.itemAt(index);
  }

  private reconcile(virtualizer: Virtualizer<HTMLElement, HTMLElement>, disclosure: number): boolean {
    const width = this.width;
    if (width === this.stampedWidth && disclosure === this.stampedDisclosure) return false;
    this.stampedWidth = width;
    this.stampedDisclosure = disclosure;
    const mountedKeys = new Set(this.rows.map((row) => String(row.key)));
    let dropped = false;
    for (const [key, stamp] of this.stamps) {
      const item = this.itemAt(key);
      if (item !== undefined && stamp.width === width && (item.open ?? false) === stamp.open) continue;
      if (item !== undefined && mountedKeys.has(key)) {
        this.stamps.set(key, { width, open: item.open ?? false });
        continue;
      }
      this.stamps.delete(key);
      virtualizer.itemSizeCache.delete(key);
      dropped = true;
    }
    if (dropped) this.itemKey = (index) => this.rows_.keyAt(index) ?? index;
    return mountedKeys.size > 0;
  }

  private measureMounted(): void {
    for (const node of this.rowNodes()) this.measureRow(node);
  }

  private rowNodes(): HTMLElement[] {
    return [...(this.root?.querySelectorAll<HTMLElement>('[data-timeline-key]') ?? [])];
  }

  private rowNode(key: string): HTMLElement | undefined {
    return this.rowNodes().find((node) => node.dataset.timelineKey === key);
  }

  private rememberedRows(): VirtualItem[] {
    const thread = this.threadKey;
    const root = this.root;
    if (thread === null || !root) return [];
    const width = this.width;
    this.stampedWidth = width;
    return this.memory
      .measurements(thread, (key, stamp) => stamp.width === width && (this.itemAt(key)?.open ?? false) === stamp.open)
      .map((measured) => {
        this.stamps.set(String(measured.row.key), measured.stamp);
        return measured.row;
      });
  }

  private publish(now = false): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    const commit = () => {
      this.rows = virtualizer.getVirtualItems();
      this.totalSize = virtualizer.getTotalSize();
      this.publishHeld();
      this.publishVisible(virtualizer.range);
    };
    if (!now || this.measuring || this.flushing) {
      commit();
      return;
    }
    this.flushing = true;
    try {
      flushSync(commit);
    } finally {
      this.flushing = false;
    }
  }

  private publishHeld(): void {
    const held = this.heldKeys;
    if (this.held.length === held.size && this.held.every((key) => held.has(key))) return;
    this.heldKeys = new Set(this.held);
  }

  private publishVisible(range: { startIndex: number; endIndex: number } | null): void {
    const keys: string[] = [];
    if (range !== null) for (let index = range.startIndex; index <= range.endIndex; index += 1) keys.push(this.rows_.keyAt(index) ?? '');
    const held = this.visibleKeys;
    if (keys.length === held.length && keys.every((key, index) => key === held[index])) return;
    this.visibleKeys = keys;
  }

  private measureMargin(): void {
    const root = this.root;
    const list = this.list;
    if (!root || !list) return;
    this.margin = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  }

  private remember(): void {
    const key = this.threadKey;
    const virtualizer = this.virtualizer;
    if (key === null || !virtualizer) return;
    const measured = virtualizer.takeSnapshot().flatMap((row) => {
      const stamp = this.stamps.get(String(row.key));
      return stamp === undefined ? [] : [{ row, stamp }];
    });
    if (measured.length > 0) this.memory.keep(key, measured);
  }

  private dropVirtualizer(): void {
    for (const frame of this.remeasuring.values()) cancelAnimationFrame(frame);
    this.remeasuring.clear();
    if (this.widening !== undefined) cancelAnimationFrame(this.widening);
    this.widening = undefined;
    if (this.prependFrame !== undefined) cancelAnimationFrame(this.prependFrame);
    this.prependFrame = undefined;
    this.prependAnchor = undefined;
    this.prependLoading = false;
    if (this.pinning !== undefined) cancelAnimationFrame(this.pinning);
    this.pinning = undefined;
    this.pinned = [];
    this.chasing = false;
    this.aim = undefined;
    this.alive.clear();
    this.stamps.clear();
    this.stampedWidth = 0;
    this.stampedDisclosure = -1;
    this.held = NO_KEYS;
    this.heldKeys = new Set();
    this.release?.();
    this.release = undefined;
    this.virtualizer = undefined;
    this.rows = [];
    this.totalSize = 0;
    this.visibleKeys = [];
  }
}

function includes(sorted: readonly number[], value: number): boolean {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = sorted[middle]!;
    if (at === value) return true;
    if (at < value) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function merged(sorted: readonly number[], extra: readonly number[]): number[] {
  const out: number[] = [];
  let next = 0;
  for (const value of sorted) {
    while (next < extra.length && extra[next]! < value) out.push(extra[next++]!);
    out.push(value);
  }
  while (next < extra.length) out.push(extra[next++]!);
  return out;
}
