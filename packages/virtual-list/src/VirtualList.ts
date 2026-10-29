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
import { flushSync, untrack } from 'svelte';

type Key = VirtualItem['key'];
type Core = Virtualizer<HTMLElement, HTMLElement>;

export interface ListOptions {
  count: number;
  getScrollElement(): HTMLElement | null;
  estimateSize(index: number): number;
  getItemKey?(index: number): Key;
  indexOf?(key: Key): number;
  keyOf?(node: HTMLElement): Key | undefined;
  overscan?: number;
  rangeExtractor?(range: Range): number[];
  gap?: number;
  scrollMargin?: number;
  paddingEnd?: number;
  scrollPaddingStart?: number;
  anchorTo?: 'start' | 'end';
  followOnAppend?: boolean;
  scrollEndThreshold?: number;
  initialOffset?: number | (() => number);
  initialRect?: { width: number; height: number };
  initialMeasurementsCache?: VirtualItem[];
  reuseOnMount?: boolean;
  isScrollWriteBlocked?(): boolean;
  onChange?(instance: Core, sync: boolean): void;
  onScroll?(offset: number, scrolling: boolean): void;
  onResize?(): void;
  beforeMeasure?(node: HTMLElement): void;
  onMeasure?(node: HTMLElement, size: number): void;
  adjust?(item: VirtualItem, delta: number, instance: Core): boolean;
}

type Box = { node: HTMLElement; sized: boolean; top: number; height: number };

export class VirtualList extends Virtualizer<HTMLElement, HTMLElement> {
  private binding: ListOptions;
  private list: HTMLElement | undefined;
  private listHeight = -1;
  private readonly boxes = new Map<Key, Box>();
  private readonly items = new Map<Key, VirtualItem>();
  private indices: Map<Key, number> | undefined;
  private readonly keys = new WeakMap<HTMLElement, Key>();
  private readonly mounting = new WeakMap<HTMLElement, number>();
  private readonly pending = new Set<HTMLElement>();
  private measuring = false;
  private unpublished = false;
  private flushing = false;
  private release: (() => void) | undefined;

  constructor(options: ListOptions) {
    super({ ...options, observeElementRect, observeElementOffset, scrollToFn: elementScroll });
    this.binding = options;
    this.configure(options);
  }

  readonly configure = (options: ListOptions): void =>
    untrack(() => {
      if (options.count !== this.binding.count || options.getItemKey !== this.binding.getItemKey) this.indices = undefined;
      this.binding = options;
      this.setOptions({
        ...options,
        rangeExtractor: options.rangeExtractor ?? defaultRangeExtractor,
        observeElementRect: this.observeRect,
        observeElementOffset: this.observeOffset,
        scrollToFn: this.scroll,
        measureElement: this.read,
        onChange: this.changed,
      });
      if (this.itemSizeCache.size > options.count * 2 + 64) {
        const live = new Set(Array.from({ length: options.count }, (_row, index) => this.options.getItemKey(index)));
        for (const key of this.itemSizeCache.keys()) if (!live.has(key)) this.itemSizeCache.delete(key);
      }
      this.indexFromElement = this.index;
      this.shouldAdjustScrollPositionOnItemSizeChange =
        options.adjust ?? ((item, _delta, instance) => item.end <= (instance.scrollOffset ?? 0));
    });

  readonly connect = (): void =>
    untrack(() => {
      this.release = this._didMount();
      const root = this.options.getScrollElement();
      if (root) root.style.overflowAnchor = 'none';
      this.refresh();
    });

  readonly refresh = (): void =>
    untrack(() => {
      this.size();
      this._willUpdate();
      this.changed(this, false);
    });

  readonly invalidateSizes = (): void =>
    untrack(() => {
      const held = this.getVirtualItems().flatMap((item) => {
        const size = this.itemSizeCache.get(item.key);
        return size === undefined ? [] : [{ key: item.key, size }];
      });
      this.measuring = true;
      try {
        this.measure();
        for (const { key, size } of held) this.itemSizeCache.set(key, size);
      } finally {
        this.measuring = false;
        this.unpublished = false;
        this.changed(this, false);
      }
    });

  dispose(): void {
    this.release?.();
    this.release = undefined;
    this.boxes.clear();
    this.items.clear();
    this.indices = undefined;
    this.pending.clear();
    this.list = undefined;
  }

  readonly span = (node: HTMLElement | undefined): (() => void) =>
    untrack(() => {
      this.list = node;
      this.listHeight = -1;
      this.size();
      return () => {
        if (this.list === node) this.list = undefined;
      };
    });

  readonly box = (key: Key, node: HTMLElement, sized = false): (() => void) =>
    untrack(() => {
      const box = { node, sized, top: Number.NaN, height: Number.NaN };
      this.boxes.set(key, box);
      const item = this.items.get(key) ?? this.getVirtualItems().find((item) => item.key === key);
      if (item) this.place(box, item);
      return () => {
        if (this.boxes.get(key) === box) this.boxes.delete(key);
      };
    });

  mountRow(node: HTMLElement, key?: Key): void {
    if (key !== undefined) this.keys.set(node, key);
    if (this.pending.size === 0)
      queueMicrotask(() => {
        const nodes = [...this.pending];
        this.pending.clear();
        this.measureRows(nodes);
      });
    this.pending.add(node);
  }

  readonly measureRows = (nodes: readonly HTMLElement[]): void =>
    untrack(() => {
      const read = nodes
        .filter((node) => node.isConnected)
        .map((node) => {
          const index = this.index(node);
          const cached = this.binding.reuseOnMount && index >= 0 ? this.itemSizeCache.get(this.options.getItemKey(index)) : undefined;
          if (cached === undefined) this.binding.beforeMeasure?.(node);
          return { node, index, height: cached ?? node.offsetHeight };
        });
      read.sort((left, right) => right.index - left.index);
      this.measuring = true;
      try {
        for (const { node, index, height } of read) {
          if (index < 0) continue;
          this.mounting.set(node, height);
          try {
            this.measureElement(node);
            this.resizeItem(index, this.record(node, height, index));
          } finally {
            this.mounting.delete(node);
          }
        }
      } finally {
        const unpublished = this.unpublished;
        this.measuring = false;
        this.unpublished = false;
        if (unpublished) this.changed(this, false);
      }
    });

  readonly measureRow = (node: HTMLElement, key?: Key): void => {
    if (key !== undefined) this.keys.set(node, key);
    this.measureRows([node]);
  };

  private readonly index = (node: HTMLElement): number => {
    const key = this.keys.get(node) ?? this.binding.keyOf?.(node);
    if (key === undefined) return -1;
    if (this.binding.indexOf) return this.binding.indexOf(key);
    if (this.indices === undefined) {
      this.indices = new Map();
      for (let index = 0; index < this.options.count; index += 1) this.indices.set(this.options.getItemKey(index), index);
    }
    return this.indices.get(key) ?? -1;
  };

  private readonly read = (node: HTMLElement, entry: ResizeObserverEntry | undefined, instance: Core): number => {
    if (!this.mounting.has(node)) untrack(() => this.binding.beforeMeasure?.(node));
    const size = this.mounting.get(node) ?? measureElement(node, entry, instance);
    return this.record(node, size, this.index(node));
  };

  private record(node: HTMLElement, size: number, index: number): number {
    if (index < 0) return size;
    const key = this.options.getItemKey(index);
    untrack(() => this.binding.onMeasure?.(node, size));
    if (!this.itemSizeCache.has(key) && this.measurementsCache[index]?.size === size) this.itemSizeCache.set(key, size);
    return size;
  }

  private readonly observeRect = (instance: Core, changed: (rect: { width: number; height: number }) => void) =>
    observeElementRect(instance, (rect) => {
      changed(rect);
      untrack(() => this.binding.onResize?.());
    });

  private readonly observeOffset = (instance: Core, changed: (offset: number, scrolling: boolean) => void) =>
    observeElementOffset(instance, (offset, scrolling) => {
      changed(offset, scrolling);
      untrack(() => this.binding.onScroll?.(offset, scrolling));
    });

  private readonly scroll = (offset: number, options: { adjustments?: number; behavior?: ScrollBehavior }, instance: Core): void => {
    const target = offset + (options.adjustments ?? 0);
    const end = this.listHeight + this.options.scrollMargin - (this.scrollRect?.height ?? 0);
    if (target > Math.max(0, end)) this.size();
    elementScroll(offset, options, instance);
  };

  private readonly changed = (_instance: Core, sync: boolean): void => {
    if (this.measuring) return void (this.unpublished = true);
    this.size();
    this.items.clear();
    for (const item of this.getVirtualItems()) {
      this.items.set(item.key, item);
      const box = this.boxes.get(item.key);
      if (box) this.place(box, item);
    }
    const publish = () => untrack(() => this.binding.onChange?.(this, sync));
    if (!sync || this.measuring || this.flushing) {
      publish();
      return;
    }
    this.flushing = true;
    try {
      flushSync(publish);
    } finally {
      this.flushing = false;
    }
  };

  private place(box: Box, item: VirtualItem): void {
    const top = item.start - this.options.scrollMargin;
    if (box.top !== top) {
      box.top = top;
      box.node.style.top = `${top}px`;
    }
    if (box.sized && box.height !== item.size) {
      box.height = item.size;
      box.node.style.height = `${item.size}px`;
    }
  }

  private size(): void {
    if (!this.list) return;
    const height = this.getTotalSize();
    if (height === this.listHeight) return;
    this.listHeight = height;
    this.list.style.height = `${height}px`;
  }
}
