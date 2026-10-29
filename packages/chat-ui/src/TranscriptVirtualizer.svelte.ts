import type { Range, Virtualizer, VirtualItem } from '@tanstack/virtual-core';
import { type ListOptions, VirtualList } from '@runlith/virtual-list/VirtualList';
import { flushSync } from 'svelte';
import type { FeedMemory, MeasuredStamp } from './FeedMemory';
import { KeptRows } from './keptRows';
import { RowWindow } from './rowWindow';
import { DESKTOP_METRICS, type FeedMetrics, type FeedType, feedMetrics, feedType, sameMetrics } from './rowEstimate';
import type { ChatTimelineItem, RowModel } from './timeline';

const ESTIMATED_ROW_PX = 60;
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

type Feed = VirtualList;
type Anchor = { readonly key: string; readonly index: number; readonly offset: number };
type Pressed = { readonly key: string; readonly node: HTMLElement; readonly row: HTMLElement; inRow: number };
type Aim = { key: string; index: number; behavior: ScrollBehavior; landed: boolean; via?: number | undefined };
type Box = { node: HTMLElement; release: (() => void) | undefined };

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
  private release: (() => void) | undefined;
  private root: HTMLElement | undefined;
  private list: HTMLElement | undefined;
  private threadKey: string | null = null;
  private rows_: RowModel = EMPTY_ROWS;
  private shape: number | null = null;
  private readonly kept = new KeptRows();
  private readonly stamps = new Map<string, MeasuredStamp>();
  private readonly boxes = new Map<string, Box>();
  private readonly around = new RowWindow();
  private pacing: number | undefined;
  private width = 0;
  private type: FeedType | undefined;
  private fonts = 0;
  private epoch = '';
  private stamped = { width: 0, epoch: '', disclosure: -1 };
  private aim: Aim | undefined;
  private pressed: Pressed | undefined;
  private anchor: Anchor | undefined;
  private flushing = false;
  private writesHeld = false;
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
    if (bound) this.virtualizer?.span(input.list);
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
      virtualizer.configure(this.options());
    }
    virtualizer.refresh();
    if (built) this.measureMounted();
    if (reshaped) this.reaim(virtualizer);
    if (successor !== undefined) this.relocate(virtualizer, successor);
    this.holdTail();
  }

  holdWrites(held: boolean): void {
    if (held === this.writesHeld) return;
    this.writesHeld = held;
    if (!held) this.virtualizer?.refresh();
  }

  keepEnd(keeps: boolean): void {
    if (keeps === this.keepsEnd) return;
    this.keepsEnd = keeps;
    const virtualizer = this.virtualizer;
    if (!virtualizer) return;
    if (!keeps && this.aim === undefined) virtualizer.cancelScroll();
    virtualizer.configure(this.options());
    if (keeps) this.toEnd();
  }

  remeasure(): void {
    const virtualizer = this.virtualizer;
    const margin = this.margin;
    this.measureFeed();
    if (!virtualizer || this.margin === margin) return;
    virtualizer.configure(this.options());
    virtualizer.refresh();
    this.holdTail();
  }

  measureRow(node: HTMLElement): void {
    this.virtualizer?.measureRow(node);
  }

  mountRow(node: HTMLElement): void {
    this.virtualizer?.mountRow(node);
  }

  readonly box = (key: string, node: HTMLElement): (() => void) => {
    const held = { node, release: this.virtualizer?.box(key, node, true) };
    this.boxes.set(key, held);
    return () => {
      if (this.boxes.get(key) !== held) return;
      held.release?.();
      this.boxes.delete(key);
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
    if (this.virtualizer) this.travel(this.virtualizer, this.aim, true);
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
    this.building = true;
    try {
      const virtualizer = new VirtualList({ ...this.options(), initialMeasurementsCache: this.rememberedRows() });
      this.virtualizer = virtualizer;
      this.stamped = { width: this.width, epoch: this.epoch, disclosure };
      virtualizer.span(this.list);
      for (const [key, held] of this.boxes) held.release = virtualizer.box(key, held.node, true);
      const fonts = root.ownerDocument.fonts as FontFaceSet | undefined;
      fonts?.addEventListener?.('loadingdone', this.fontsLoaded);
      this.release = () => {
        fonts?.removeEventListener?.('loadingdone', this.fontsLoaded);
        virtualizer.dispose();
      };
      virtualizer.connect();
    } finally {
      this.building = false;
    }
    return this.virtualizer!;
  }

  private readonly fontsLoaded = (): void => {
    this.fonts += 1;
    this.measureFeed();
  };

  private shifts(item: VirtualItem, delta: number, instance: Virtualizer<HTMLElement, HTMLElement>): boolean {
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
    this.around.unland();
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
      if (aim.via !== undefined && Math.abs((virtualizer.scrollOffset ?? 0) - aim.via) < this.height) {
        aim.via = undefined;
        virtualizer.scrollToIndex(aim.index, { align: 'start', behavior: aim.behavior });
      }
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
    this.travel(virtualizer, aim);
  }

  private travel(virtualizer: Feed, aim: Aim, now = false): void {
    const target = virtualizer.getOffsetForIndex(aim.index, 'start')?.[0];
    const top = virtualizer.scrollOffset ?? 0;
    const far = target !== undefined && Math.abs(target - top) > this.height;
    aim.via = far && aim.behavior === 'smooth' ? target! - Math.sign(target! - top) * this.height : undefined;
    if (aim.via === undefined) virtualizer.scrollToIndex(aim.index, { align: 'start', behavior: aim.behavior });
    else virtualizer.scrollToOffset(aim.via);
    if (!far) return;
    const at = aim.via ?? target!;
    const from = virtualizer.getVirtualItemForOffset(Math.min(at, target!))?.index ?? 0;
    this.around.land(from, virtualizer.getVirtualItemForOffset(Math.max(at, target!) + this.height)?.index ?? from);
    this.rewindow(virtualizer);
    this.publish(now);
  }

  private rewindow(virtualizer: Feed): void {
    virtualizer.configure(this.options());
  }

  private holdTail(): void {
    if (this.keepsEnd) this.toEnd();
  }

  private options(): ListOptions {
    const model = this.rows_;
    const keeps = this.keepsEnd;
    return {
      count: model.count,
      getScrollElement: () => this.root ?? null,
      estimateSize: (index: number) => model.itemAt(index)?.estimate ?? ESTIMATED_ROW_PX,
      getItemKey: this.itemKey,
      indexOf: (key) => this.rows_.indexOf(String(key)),
      keyOf: (node) => node.dataset.timelineKey,
      reuseOnMount: true,
      isScrollWriteBlocked: () => this.writesHeld,
      adjust: (item, delta, instance) => this.shifts(item, delta, instance),
      rangeExtractor: (range: Range) => this.window(range),
      scrollMargin: this.margin,
      scrollPaddingStart: ROW_LANDING_GAP_PX,
      paddingEnd: this.clearance,
      anchorTo: 'end' as const,
      followOnAppend: keeps,
      scrollEndThreshold: keeps ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      initialOffset: () => (this.keepsEnd ? Number.MAX_SAFE_INTEGER : 0),
      onMeasure: (node) => this.measured(node),
      onResize: () => this.resized(),
      onScroll: (_offset, scrolling) => {
        if (scrolling) this.moved();
      },
      onChange: () => this.publish(),
    };
  }

  private resized(): void {
    if (this.building) return;
    this.measureFeed();
    this.holdTail();
  }

  private measured(node: HTMLElement): void {
    const key = node.dataset.timelineKey;
    const item = key === undefined ? undefined : this.rows_.item(key);
    if (key !== undefined && item !== undefined) this.stamps.set(key, { width: this.width, estimate: item.estimate, epoch: this.epoch });
  }

  private window(range: Range): number[] {
    const virtualizer = this.virtualizer;
    const laid = virtualizer?.measurementsCache ?? [];
    const frames = typeof requestAnimationFrame === 'function';
    const paced = frames && virtualizer !== undefined && (this.aiming || virtualizer.isScrolling || this.around.pending);
    const indexes = this.around.indexes(range, laid, this.height, paced, this.aiming);
    if (frames && this.around.awaitsFrame) this.pacing ??= requestAnimationFrame(this.paceNext);
    return this.kept.extend(indexes, this.rows_, range.count);
  }

  private get aiming(): boolean {
    return this.aim !== undefined && !this.aim.landed;
  }

  private readonly paceNext = (): void => {
    this.pacing = undefined;
    this.around.frame();
    const virtualizer = this.virtualizer;
    if (!virtualizer || !this.around.pending) return;
    if (this.aiming) {
      this.pacing = requestAnimationFrame(this.paceNext);
      return;
    }
    this.rewindow(virtualizer);
    this.publish();
  };

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
    this.virtualizer?.measureRows(this.rowNodes());
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
      let rows = virtualizer.getVirtualItems();
      if (this.around.short(virtualizer.measurementsCache, this.height)) {
        this.rewindow(virtualizer);
        rows = virtualizer.getVirtualItems();
      }
      this.rows = rows;
      this.publishHeld();
      this.publishVisible(virtualizer.range);
    };
    if (!now || this.flushing) {
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
    if (this.pacing !== undefined) cancelAnimationFrame(this.pacing);
    this.pacing = undefined;
    this.around.clear();
    this.aim = undefined;
    this.pressed = undefined;
    this.anchor = undefined;
    this.kept.clear();
    this.stamps.clear();
    this.stamped = { width: 0, epoch: '', disclosure: -1 };
    this.heldKeys = new Set();
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
