import {
  defaultRangeExtractor,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  type Range,
  Virtualizer,
  type VirtualItem,
} from '@tanstack/virtual-core';
import { flushSync } from 'svelte';
import type { FeedMemory, MeasuredStamp } from './FeedMemory';
import { KeptRows } from './keptRows';
import { DESKTOP_METRICS, type FeedMetrics, type FeedType, feedMetrics, sameMetrics } from './rowEstimate';
import type { ChatTimelineItem, RowModel } from './timeline';

const ESTIMATED_ROW_PX = 60;
const OVERSCAN_ROWS = 20;
const OPENING_OVERSCAN_ROWS = 6;
export const TRANSCRIPT_END_THRESHOLD_PX = 80;
const ROW_LANDING_GAP_PX = 12;
const MOVED_PX = 1.5;
const UNPLACED_PX = 1e12;
const EMPTY_ROWS: RowModel = {
  revision: 0,
  shape: 0,
  count: 0,
  keyAt: () => undefined,
  itemAt: () => undefined,
  item: () => undefined,
  indexOf: () => -1,
};

type Feed = Virtualizer<HTMLElement, HTMLElement>;
type Anchor = { readonly key: string; readonly index: number; readonly offset: number };
type Pressed = { readonly key: string; readonly node: HTMLElement; readonly row: HTMLElement; inRow: number };
type Aim = { key: string; index: number; behavior: ScrollBehavior; landed: boolean };
type Placed = { top: number; height: number };

export class TranscriptVirtualizer {
  rows = $state.raw<readonly VirtualItem[]>([]);
  visibleKeys = $state.raw<readonly string[]>([]);
  heldKeys = $state.raw<ReadonlySet<string>>(new Set());
  metrics = $state.raw<FeedMetrics>(DESKTOP_METRICS);

  private virtualizer: Feed | undefined;
  private keepsEnd = true;
  private building = false;
  private clearance = 0;
  private margin = 0;
  private overscan = OPENING_OVERSCAN_ROWS;
  private widening: number | undefined;
  private release: (() => void) | undefined;
  private root: HTMLElement | undefined;
  private list: HTMLElement | undefined;
  private listHeight = -1;
  private threadKey: string | null = null;
  private rows_: RowModel = EMPTY_ROWS;
  private shape: number | null = null;
  private readonly kept = new KeptRows();
  private readonly stamps = new Map<string, MeasuredStamp>();
  private readonly boxes = new Map<string, HTMLElement>();
  private readonly placed = new WeakMap<HTMLElement, Placed>();
  private items = new Map<string, VirtualItem>();
  private width = 0;
  private type: FeedType | undefined;
  private fonts = 0;
  private epoch = '';
  private stamped = { width: 0, epoch: '', disclosure: -1 };
  private aim: Aim | undefined;
  private pressed: Pressed | undefined;
  private anchor: Anchor | undefined;
  private measuring = false;
  private flushing = false;
  private itemKey = (index: number): string | number => this.rows_.keyAt(index) ?? index;

  constructor(
    private readonly memory: FeedMemory,
    private readonly scrolled: (reader: boolean) => void = () => undefined,
  ) {}

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
    clearance: number;
    disclosure: number;
  }): void {
    const held = this.virtualizer !== undefined && input.root === this.root && !this.keepsEnd ? this.anchorAt(this.virtualizer) : undefined;
    this.rows_ = input.model;
    const reshaped = input.shape !== this.shape;
    const successor =
      reshaped && held !== undefined && this.aim === undefined && this.rows_.indexOf(held.key) < 0
        ? this.survivor(this.virtualizer!, held)
        : undefined;
    if (reshaped) {
      this.shape = input.shape;
      this.itemKey = (index) => this.rows_.keyAt(index) ?? index;
    }
    this.clearance = input.clearance;
    const rebuilt = input.root !== this.root;
    if (rebuilt) {
      this.remember();
      this.root = input.root;
    }
    const bound = input.list !== this.list;
    this.list = input.list;
    if (bound) this.listHeight = -1;
    if (rebuilt || bound) this.measureFeed();
    if (!input.root) {
      this.dropVirtualizer();
      return;
    }
    let virtualizer = this.virtualizer;
    const built = rebuilt || !virtualizer;
    if (rebuilt || !virtualizer) {
      virtualizer = this.build(input.root, input.disclosure);
    } else {
      const widened = this.width !== this.stamped.width || this.epoch !== this.stamped.epoch;
      this.reconcile(virtualizer, input.disclosure);
      if (widened && held !== undefined && this.aim === undefined) this.freeze(virtualizer, held);
      virtualizer.setOptions(this.options());
    }
    this.size(virtualizer);
    virtualizer._willUpdate();
    this.publish();
    if (built) this.measureMounted();
    if (reshaped) this.reaim(virtualizer);
    if (successor !== undefined) this.relocate(virtualizer, successor);
    this.holdTail();
  }

  keepEnd(keeps: boolean): void {
    if (keeps === this.keepsEnd) return;
    this.keepsEnd = keeps;
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    if (!keeps && this.aim === undefined) virtualizer.cancelScroll();
    virtualizer.setOptions(this.options());
    if (keeps) this.toEnd();
  }

  remeasure(): void {
    const virtualizer = this.virtualizer;
    const margin = this.margin;
    this.measureFeed();
    if (!virtualizer || this.margin === margin) return;
    virtualizer.setOptions(this.options());
    this.size(virtualizer);
    virtualizer._willUpdate();
    this.publish();
    this.holdTail();
  }

  measureRow(node: HTMLElement): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    this.measuring = true;
    try {
      virtualizer.measureElement(node);
      const key = node.dataset.timelineKey;
      const index = key === undefined ? -1 : this.rows_.indexOf(key);
      if (index >= 0 && node.isConnected && !virtualizer.itemSizeCache.has(key!)) {
        virtualizer.resizeItem(index, this.measured(node, node.offsetHeight, virtualizer));
      }
    } finally {
      this.measuring = false;
    }
  }

  readonly box = (key: string, node: HTMLElement): (() => void) => {
    this.boxes.set(key, node);
    const item = this.items.get(key);
    if (item !== undefined) this.placeBox(node, item);
    return () => {
      if (this.boxes.get(key) === node) this.boxes.delete(key);
    };
  };

  keep(keys: readonly string[]): void {
    this.kept.keep(keys);
  }

  press(control: HTMLElement): void {
    const row = control.closest<HTMLElement>('[data-timeline-key]');
    const key = row?.dataset.timelineKey;
    this.pressed = row === null || key === undefined ? undefined : { key, node: control, row, inRow: offsetIn(control, row) };
  }

  holds(key: string): boolean {
    return this.virtualizer !== undefined && this.rows_.indexOf(key) >= 0;
  }

  scrollToRow(key: string, behavior: ScrollBehavior): void {
    const index = this.rows_.indexOf(key);
    if (index < 0) return;
    this.pressed = undefined;
    this.aim = { key, index, behavior, landed: false };
    this.virtualizer?.scrollToIndex(index, { align: 'start', behavior });
  }

  toEnd(): void {
    const virtualizer = this.virtualizer;
    this.aim = undefined;
    if (!virtualizer || this.rows_.count === 0 || this.building) return;
    if (virtualizer.getDistanceFromEnd() < 1) return;
    virtualizer.scrollToEnd();
  }

  scrollBy(delta: number): void {
    if (this.aim !== undefined) this.virtualizer?.cancelScroll();
    this.aim = undefined;
    this.pressed = undefined;
    this.virtualizer?.scrollBy(delta);
  }

  letGo(): void {
    this.aim = undefined;
    this.pressed = undefined;
    this.virtualizer?.cancelScroll();
  }

  get offset(): number {
    const top = this.virtualizer?.scrollOffset ?? 0;
    return top > UNPLACED_PX ? this.end : top;
  }

  get end(): number {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return 0;
    const top = virtualizer.scrollOffset ?? 0;
    return (top > UNPLACED_PX ? 0 : top) + virtualizer.getDistanceFromEnd();
  }

  get height(): number {
    return this.virtualizer?.scrollRect?.height || (this.root?.clientHeight ?? 0);
  }

  get head(): number {
    return this.offset - (this.virtualizer?.measurementsCache[0]?.start ?? 0);
  }

  rowAt(offset: number): number | undefined {
    return this.virtualizer?.getVirtualItemForOffset(offset)?.index;
  }

  rowOf(key: string): number {
    return this.rows_.indexOf(key);
  }

  rowSpan(key: string): { readonly start: number; readonly end: number; readonly landing: number } | undefined {
    const index = this.rows_.indexOf(key);
    const item = index < 0 ? undefined : this.virtualizer?.measurementsCache[index];
    return item === undefined ? undefined : { start: item.start, end: item.end, landing: item.start - ROW_LANDING_GAP_PX };
  }

  dispose(): void {
    this.remember();
    this.dropVirtualizer();
  }

  private build(root: HTMLElement, disclosure: number): Feed {
    this.dropVirtualizer();
    this.overscan = OPENING_OVERSCAN_ROWS;
    this.building = true;
    try {
      const virtualizer = new Virtualizer({ ...this.options(), initialMeasurementsCache: this.rememberedRows() });
      this.virtualizer = virtualizer;
      this.stamped = { width: this.width, epoch: this.epoch, disclosure };
      virtualizer.indexFromElement = (node) => this.rows_.indexOf(node.dataset.timelineKey ?? '');
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => this.shifts(item, delta, instance);
      const release = virtualizer._didMount();
      const fonts = root.ownerDocument.fonts as FontFaceSet | undefined;
      fonts?.addEventListener?.('loadingdone', this.fontsLoaded);
      this.release = () => {
        fonts?.removeEventListener?.('loadingdone', this.fontsLoaded);
        release();
      };
      this.size(virtualizer);
      virtualizer._willUpdate();
    } finally {
      this.building = false;
    }
    this.widen();
    return this.virtualizer!;
  }

  private readonly fontsLoaded = (): void => {
    this.fonts += 1;
    this.measureFeed();
  };

  private shifts(item: VirtualItem, delta: number, instance: Feed): boolean {
    const pressed = this.pressed;
    if (pressed !== undefined && pressed.key === String(item.key) && pressed.node.isConnected) {
      const inRow = offsetIn(pressed.node, pressed.row);
      const moved = inRow - pressed.inRow;
      pressed.inRow = inRow;
      return Math.abs(moved - delta) < Math.abs(moved);
    }
    return item.end <= (instance.scrollOffset ?? 0);
  }

  private moved(): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    const held = this.anchor;
    const now = this.anchorAt(virtualizer);
    this.anchor = now;
    let travel = 0;
    if (held !== undefined && now !== undefined) {
      const index = this.rows_.indexOf(held.key);
      const item = index < 0 ? undefined : virtualizer.measurementsCache[index];
      if (item !== undefined) travel = (virtualizer.scrollOffset ?? 0) - item.start - held.offset;
    }
    let reader = Math.abs(travel) >= MOVED_PX;
    const aim = this.aim;
    if (aim !== undefined && !aim.landed) {
      const target = virtualizer.getOffsetForIndex(aim.index, 'start')?.[0];
      aim.landed = target !== undefined && Math.abs((virtualizer.scrollOffset ?? 0) - target) < MOVED_PX;
      reader = false;
    } else if (aim !== undefined && reader) {
      this.aim = undefined;
    }
    this.scrolled(reader);
  }

  private anchorAt(virtualizer: Feed): Anchor | undefined {
    const top = virtualizer.scrollOffset;
    if (top === null || top > UNPLACED_PX) return undefined;
    const item = virtualizer.getVirtualItemForOffset(top);
    return item === undefined ? undefined : { key: String(item.key), index: item.index, offset: top - item.start };
  }

  private survivor(virtualizer: Feed, lost: Anchor): string | undefined {
    const laid = virtualizer.measurementsCache;
    const survives = (index: number): string | undefined => {
      const key = laid[index] === undefined ? undefined : String(laid[index]!.key);
      return key !== undefined && this.rows_.indexOf(key) >= 0 ? key : undefined;
    };
    for (let index = lost.index + 1; index < laid.length; index += 1) {
      const key = survives(index);
      if (key !== undefined) return key;
    }
    for (let index = lost.index - 1; index >= 0; index -= 1) {
      const key = survives(index);
      if (key !== undefined) return key;
    }
    return undefined;
  }

  private relocate(virtualizer: Feed, key: string): void {
    const index = this.rows_.indexOf(key);
    const start = virtualizer.measurementsCache[index]?.start;
    if (start === undefined) return;
    this.anchor = { key, index, offset: 0 };
    if (Math.abs(start - (virtualizer.scrollOffset ?? 0)) >= 1) virtualizer.scrollToOffset(start);
  }

  private reaim(virtualizer: Feed): void {
    const aim = this.aim;
    if (aim === undefined) return;
    const index = this.rows_.indexOf(aim.key);
    if (index < 0) {
      this.aim = undefined;
      return;
    }
    if (index === aim.index) return;
    aim.index = index;
    aim.landed = false;
    virtualizer.scrollToIndex(index, { align: 'start', behavior: aim.behavior });
  }

  private holdTail(): void {
    if (this.keepsEnd) this.toEnd();
  }

  private widen(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.overscan = OVERSCAN_ROWS;
      return;
    }
    if (this.widening !== undefined) cancelAnimationFrame(this.widening);
    this.widening = requestAnimationFrame(() => {
      this.widening = undefined;
      const virtualizer = this.virtualizer;
      if (!virtualizer || this.overscan === OVERSCAN_ROWS) return;
      this.overscan = OVERSCAN_ROWS;
      virtualizer.setOptions(this.options());
      virtualizer._willUpdate();
      this.publish();
    });
  }

  private options() {
    const model = this.rows_;
    const keeps = this.keepsEnd;
    return {
      count: model.count,
      getScrollElement: () => this.root ?? null,
      estimateSize: (index: number) => model.itemAt(index)?.estimate ?? ESTIMATED_ROW_PX,
      getItemKey: this.itemKey,
      overscan: this.overscan,
      rangeExtractor: (range: Range) => this.mounted(range),
      scrollMargin: this.margin,
      scrollPaddingStart: ROW_LANDING_GAP_PX,
      paddingEnd: this.clearance,
      anchorTo: 'end' as const,
      followOnAppend: keeps,
      scrollEndThreshold: keeps ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      initialOffset: () => (this.keepsEnd ? Number.MAX_SAFE_INTEGER : 0),
      scrollToFn: (offset: number, options: { adjustments?: number; behavior?: ScrollBehavior }, instance: Feed) => {
        this.size(instance);
        elementScroll(offset, options, instance);
      },
      measureElement: (node: HTMLElement, entry: ResizeObserverEntry | undefined, instance: Feed) =>
        this.measured(node, measureElement(node, entry, instance), instance),
      observeElementRect: (instance: Feed, changed: (rect: { width: number; height: number }) => void) =>
        observeElementRect(instance, (rect) => {
          changed(rect);
          this.resized();
        }),
      observeElementOffset: (instance: Feed, changed: (offset: number, scrolling: boolean) => void) =>
        observeElementOffset(instance, (offset, scrolling) => {
          changed(offset, scrolling);
          if (scrolling) this.moved();
        }),
      onChange: (_instance: Feed, sync: boolean) => this.publish(sync),
    };
  }

  private resized(): void {
    if (this.building) return;
    this.measureFeed();
    this.holdTail();
  }

  private measured(node: HTMLElement, size: number, virtualizer: Feed): number {
    const key = node.dataset.timelineKey;
    const item = key === undefined ? undefined : this.rows_.item(key);
    if (key === undefined || item === undefined) return size;
    this.stamps.set(key, { width: this.width, estimate: item.estimate, epoch: this.epoch });
    if (!virtualizer.itemSizeCache.has(key) && virtualizer.measurementsCache[this.rows_.indexOf(key)]?.size === size) {
      virtualizer.itemSizeCache.set(key, size);
    }
    return size;
  }

  private mounted(range: Range): number[] {
    return this.kept.extend(defaultRangeExtractor({ ...range, overscan: this.overscan }), this.rows_, range.count);
  }

  private itemAt(key: string): ChatTimelineItem | undefined {
    const index = this.rows_.indexOf(key);
    return index < 0 ? undefined : this.rows_.itemAt(index);
  }

  private fits(key: string, stamp: MeasuredStamp): boolean {
    return stamp.width === this.width && stamp.epoch === this.epoch && this.itemAt(key)?.estimate === stamp.estimate;
  }

  private reconcile(virtualizer: Feed, disclosure: number): void {
    const stamped = this.stamped;
    if (this.width === stamped.width && this.epoch === stamped.epoch && disclosure === stamped.disclosure) return;
    this.stamped = { width: this.width, epoch: this.epoch, disclosure };
    const mountedKeys = new Set(this.rows.map((row) => String(row.key)));
    let dropped = false;
    for (const [key, stamp] of this.stamps) {
      if (mountedKeys.has(key) || this.fits(key, stamp)) continue;
      this.stamps.delete(key);
      virtualizer.itemSizeCache.delete(key);
      dropped = true;
    }
    if (dropped) this.itemKey = (index) => this.rows_.keyAt(index) ?? index;
  }

  private freeze(virtualizer: Feed, anchor: Anchor): void {
    const laid = virtualizer.measurementsCache;
    const mountedKeys = new Set(this.rows.map((row) => row.key));
    for (let index = 0; index < anchor.index && index < laid.length; index += 1) {
      const item = laid[index];
      if (item !== undefined && !mountedKeys.has(item.key)) virtualizer.itemSizeCache.set(item.key, item.size);
    }
    this.itemKey = (index) => this.rows_.keyAt(index) ?? index;
  }

  private measureMounted(): void {
    for (const node of this.rowNodes()) this.measureRow(node);
  }

  private rowNodes(): HTMLElement[] {
    return [...(this.root?.querySelectorAll<HTMLElement>('[data-timeline-key]') ?? [])];
  }

  private rememberedRows(): VirtualItem[] {
    const thread = this.threadKey;
    if (thread === null || !this.root || this.width === 0) return [];
    return this.memory
      .measurements(thread, (key, stamp) => this.fits(key, stamp))
      .map((measured) => {
        this.stamps.set(String(measured.row.key), measured.stamp);
        return measured.row;
      });
  }

  private publish(now = false): void {
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    const commit = () => {
      const rows = virtualizer.getVirtualItems();
      this.rows = rows;
      this.place(rows, virtualizer);
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

  private place(rows: readonly VirtualItem[], virtualizer: Feed): void {
    this.size(virtualizer);
    const items = new Map<string, VirtualItem>();
    for (const item of rows) {
      const key = String(item.key);
      items.set(key, item);
      const node = this.boxes.get(key);
      if (node !== undefined) this.placeBox(node, item);
    }
    this.items = items;
  }

  private placeBox(node: HTMLElement, item: VirtualItem): void {
    const top = item.start - this.margin;
    const height = item.size;
    const was = this.placed.get(node);
    if (was !== undefined && was.top === top && was.height === height) return;
    this.placed.set(node, { top, height });
    node.style.top = `${top}px`;
    node.style.height = `${height}px`;
  }

  private size(virtualizer: Feed): void {
    const list = this.list;
    if (!list) return;
    const height = virtualizer.getTotalSize();
    if (height === this.listHeight) return;
    this.listHeight = height;
    list.style.height = `${height}px`;
  }

  private publishHeld(): void {
    const held = this.heldKeys;
    const now = this.kept.held;
    if (now.length === held.size && now.every((key) => held.has(key))) return;
    this.heldKeys = new Set(now);
  }

  private publishVisible(range: { startIndex: number; endIndex: number } | null): void {
    const keys: string[] = [];
    if (range !== null) for (let index = range.startIndex; index <= range.endIndex; index += 1) keys.push(this.rows_.keyAt(index) ?? '');
    const held = this.visibleKeys;
    if (keys.length === held.length && keys.every((key, index) => key === held[index])) return;
    this.visibleKeys = keys;
  }

  private measureFeed(): void {
    const root = this.root;
    const list = this.list;
    if (!root || !list) return;
    this.margin = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    const width = list.clientWidth;
    const epoch = `${typeof devicePixelRatio === 'number' ? devicePixelRatio : 1}:${this.fonts}`;
    if (width === this.width && epoch === this.epoch && this.type !== undefined) return;
    this.width = width;
    this.epoch = epoch;
    this.type = feedType(root);
    const metrics = feedMetrics(width, this.type);
    if (!sameMetrics(metrics, this.metrics)) this.metrics = metrics;
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
    if (this.widening !== undefined) cancelAnimationFrame(this.widening);
    this.widening = undefined;
    this.aim = undefined;
    this.pressed = undefined;
    this.anchor = undefined;
    this.kept.clear();
    this.stamps.clear();
    this.stamped = { width: 0, epoch: '', disclosure: -1 };
    this.heldKeys = new Set();
    this.items = new Map();
    this.release?.();
    this.release = undefined;
    this.virtualizer = undefined;
    this.rows = [];
    this.visibleKeys = [];
  }
}

function offsetIn(node: HTMLElement, row: HTMLElement): number {
  return node.getBoundingClientRect().top - row.getBoundingClientRect().top;
}

function feedType(root: HTMLElement): FeedType {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(root) : undefined;
  const rem =
    Number.parseFloat(typeof getComputedStyle === 'function' ? getComputedStyle(root.ownerDocument.documentElement).fontSize : '') || 16;
  const token = (name: string, fallback: number): number => {
    const value = style?.getPropertyValue(name).trim() ?? '';
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return fallback * rem;
    return value.endsWith('px') ? number : number * rem;
  };
  return {
    body: token('--text-body', 0.875),
    ui: token('--text-ui', 0.8125),
    small: token('--text-small', 0.75),
    spacing: token('--spacing', 0.25),
  };
}
