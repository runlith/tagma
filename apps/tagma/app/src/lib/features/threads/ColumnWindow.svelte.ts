import { defaultRangeExtractor, type Range, type VirtualItem } from '@tanstack/virtual-core';
import { VirtualList } from '@runlith/virtual-list/VirtualList';
import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

const GAP_PX = 1;
const OVERSCAN_LINES = 12;
const FALLBACK_VIEWPORT_PX = 600;

export type Placed<T> = { readonly line: T; readonly index: number };

export class ColumnWindow<T extends { readonly key: string }> {
  private lines = $state.raw<readonly T[]>([]);
  private revision = $state(0);
  private readonly hints = new Map<string, number>();
  private readonly attachments = new Map<string, Attachment<HTMLElement>>();
  private scroller: HTMLElement | null = null;
  private sizer: HTMLElement | null = null;
  private margin = 0;
  private keyAt = (index: number): string | number => index;
  private keep: ReadonlySet<string> = new Set();
  private readonly window: VirtualList;
  private placed: readonly VirtualItem[] = [];
  private extent = 0;

  constructor(private readonly estimate: (line: T) => number) {
    this.window = new VirtualList(this.options());
  }

  get height(): number {
    void this.revision;
    return this.extent;
  }

  lay(lines: readonly T[]): void {
    if (this.lines === lines) return;
    this.lines = lines;
    this.keyAt = (index) => lines[index]?.key ?? index;
    if (this.hints.size > lines.length * 2 + 64) this.hints.clear();
    if (this.attachments.size > lines.length * 2 + 64) {
      const live = new Set(lines.map((line) => line.key));
      for (const key of this.attachments.keys()) if (!live.has(key)) this.attachments.delete(key);
    }
    this.window.configure(this.options());
    this.window.refresh();
  }

  indexFor(key: string): number {
    const hint = this.hints.get(key);
    if (hint !== undefined && this.lines[hint]?.key === key) return hint;
    const found = this.lines.findIndex((line) => line.key === key);
    if (found >= 0) this.hints.set(key, found);
    else this.hints.delete(key);
    return found;
  }

  offset(index: number): number {
    void this.revision;
    return (this.window.measurementsCache[index]?.start ?? this.margin) - this.margin;
  }

  mounted(keep: ReadonlySet<string> = new Set()): readonly Placed<T>[] {
    void this.revision;
    if (this.keep !== keep) {
      this.keep = keep;
      this.window.configure(this.options());
    }
    return this.window.getVirtualItems().flatMap((item) => {
      const line = this.lines[item.index];
      return line === undefined ? [] : [{ line, index: item.index }];
    });
  }

  scrollTo(index: number): void {
    this.window.scrollToIndex(index, { align: 'auto' });
  }

  readonly column: Attachment<HTMLElement> = (scroller) =>
    untrack(() => {
      this.scroller = scroller;
      this.window.configure(this.options());
      this.window.connect();
      return () => {
        this.window.dispose();
        this.scroller = null;
      };
    });

  readonly span: Attachment<HTMLElement> = (sizer) =>
    untrack(() => {
      this.sizer = sizer;
      const release = this.window.span(sizer);
      const prefix = sizer.previousElementSibling;
      const observer = new ResizeObserver(() => this.readMargin());
      if (prefix !== null) observer.observe(prefix);
      this.readMargin();
      return () => {
        observer.disconnect();
        release();
        this.sizer = null;
      };
    });

  measure(key: string): Attachment<HTMLElement> {
    const held = this.attachments.get(key);
    if (held !== undefined) return held;
    const attachment: Attachment<HTMLElement> = (line) =>
      untrack(() => {
        const release = this.window.box(key, line);
        this.window.mountRow(line, key);
        return release;
      });
    this.attachments.set(key, attachment);
    return attachment;
  }

  private options() {
    const lines = this.lines;
    return {
      count: lines.length,
      getScrollElement: () => this.scroller,
      estimateSize: (index: number) => this.estimate(lines[index] as T),
      getItemKey: this.keyAt,
      indexOf: (key: string | number | bigint) => this.indexFor(String(key)),
      gap: GAP_PX,
      overscan: OVERSCAN_LINES,
      initialRect: { width: 0, height: FALLBACK_VIEWPORT_PX },
      scrollMargin: this.margin,
      anchorTo: 'end' as const,
      scrollEndThreshold: Number.NEGATIVE_INFINITY,
      rangeExtractor: (range: Range) => {
        const shown = new Set(defaultRangeExtractor(range));
        for (const key of this.keep) {
          const index = this.indexFor(key);
          if (index >= 0) shown.add(index);
        }
        return [...shown].sort((left, right) => left - right);
      },
      onResize: () => this.readMargin(),
      onChange: () => this.publish(),
    };
  }

  private readMargin(): void {
    const margin = this.sizer?.offsetTop ?? 0;
    if (margin === this.margin) return;
    this.margin = margin;
    this.window.configure(this.options());
    this.window.refresh();
  }

  private publish(): void {
    const placed = this.window.getVirtualItems();
    const height = this.window.getTotalSize();
    if (
      height === this.extent &&
      placed.length === this.placed.length &&
      placed.every((item, index) => {
        const was = this.placed[index];
        return was?.key === item.key && was.start === item.start && was.size === item.size;
      })
    )
      return;
    this.extent = height;
    this.placed = placed;
    this.revision += 1;
  }
}
