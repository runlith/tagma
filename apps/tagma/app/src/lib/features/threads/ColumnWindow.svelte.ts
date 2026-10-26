import type { Attachment } from 'svelte/attachments';

const GAP_PX = 1;
const OVERSCAN_LINES = 12;
const FALLBACK_VIEWPORT_PX = 600;

export type Placed<T> = { readonly line: T; readonly index: number };

export class ColumnWindow<T extends { readonly key: string }> {
  height = $state(0);
  private lines = $state.raw<readonly T[]>([]);
  private revision = $state(0);
  private top = $state(0);
  private viewport = $state(FALLBACK_VIEWPORT_PX);
  private margin = 0;
  private starts: number[] = [];
  private extents: number[] = [];
  private readonly sizes = new Map<string, number>();
  private readonly hints = new Map<string, number>();
  private readonly attachments = new Map<string, Attachment<HTMLElement>>();
  private scroller: HTMLElement | null = null;
  private sizer: HTMLElement | null = null;
  private watcher: ResizeObserver | null = null;
  private frame = 0;
  private dirtyFrom = Number.POSITIVE_INFINITY;

  constructor(private readonly estimate: (line: T) => number) {}

  lay(lines: readonly T[]): void {
    const was = this.lines;
    if (was === lines) return;
    const anchor = this.anchor();
    const bound = Math.min(was.length, lines.length);
    let head = 0;
    while (head < bound && was[head] === lines[head]) head += 1;
    let tail = 0;
    while (tail < bound - head && was[was.length - 1 - tail] === lines[lines.length - 1 - tail]) tail += 1;
    const kept = this.extents.slice(was.length - tail);
    this.extents.length = head;
    for (let index = head; index < lines.length - tail; index += 1) this.extents.push(this.sizeOf(lines[index] as T));
    for (const extent of kept) this.extents.push(extent);
    this.lines = lines;
    this.prune();
    const from = Math.min(head, this.dirtyFrom);
    this.dirtyFrom = Number.POSITIVE_INFINITY;
    this.reflow(from);
    if (anchor !== null) this.restore(anchor);
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
    return this.starts[index] ?? 0;
  }

  mounted(keep: ReadonlySet<string> = new Set()): readonly Placed<T>[] {
    void this.revision;
    const lines = this.lines;
    if (lines.length === 0) return [];
    const near = this.top - this.margin;
    const first = Math.max(0, this.lineAt(near) - OVERSCAN_LINES);
    const last = Math.min(lines.length - 1, this.lineAt(near + this.viewport) + OVERSCAN_LINES);
    const shown = new Set<number>();
    for (let index = first; index <= last; index += 1) shown.add(index);
    for (const key of keep) {
      const index = this.indexFor(key);
      if (index >= 0) shown.add(index);
    }
    return [...shown].sort((left, right) => left - right).map((index) => ({ line: lines[index] as T, index }));
  }

  scrollTo(index: number): void {
    const scroller = this.scroller;
    const start = this.starts[index];
    if (scroller === null || start === undefined) return;
    const size = this.extents[index] ?? 0;
    const view = scroller.scrollTop - this.margin;
    if (start < view) scroller.scrollTop = start + this.margin;
    else if (start + size > view + this.viewport) scroller.scrollTop = start + size - this.viewport + this.margin;
    this.top = scroller.scrollTop;
  }

  readonly column: Attachment<HTMLElement> = (scroller) => {
    this.scroller = scroller;
    const read = (): void => {
      this.top = scroller.scrollTop;
      this.viewport = scroller.clientHeight || FALLBACK_VIEWPORT_PX;
      this.margin = this.sizer?.offsetTop ?? 0;
    };
    read();
    scroller.addEventListener('scroll', read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', read);
      observer.disconnect();
      this.scroller = null;
    };
  };

  readonly span: Attachment<HTMLElement> = (sizer) => {
    this.sizer = sizer;
    this.margin = sizer.offsetTop;
    return () => {
      this.sizer = null;
    };
  };

  measure(key: string): Attachment<HTMLElement> {
    const held = this.attachments.get(key);
    if (held !== undefined) return held;
    const attachment: Attachment<HTMLElement> = (line) => {
      const watcher = (this.watcher ??= new ResizeObserver((entries) => this.measured(entries)));
      line.dataset.measureKey = key;
      watcher.observe(line);
      return () => watcher.unobserve(line);
    };
    this.attachments.set(key, attachment);
    return attachment;
  }

  private measured(entries: readonly ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const key = (entry.target as HTMLElement).dataset.measureKey;
      if (key === undefined) continue;
      const size = Math.round((entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height) * 100) / 100;
      if (size === 0 || this.sizes.get(key) === size) continue;
      this.sizes.set(key, size);
      const index = this.indexFor(key);
      if (index < 0) continue;
      this.extents[index] = size;
      this.dirtyFrom = Math.min(this.dirtyFrom, index);
    }
    if (this.dirtyFrom === Number.POSITIVE_INFINITY || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const from = this.dirtyFrom;
      this.dirtyFrom = Number.POSITIVE_INFINITY;
      if (from === Number.POSITIVE_INFINITY) return;
      const anchor = this.anchor();
      this.reflow(from);
      if (anchor !== null) this.restore(anchor);
    });
  }

  private reflow(at: number): void {
    const count = this.extents.length;
    const from = Math.min(at, count);
    let moved = this.starts.length !== count;
    this.starts.length = count;
    let offset = from === 0 ? 0 : (this.starts[from - 1] as number) + (this.extents[from - 1] as number) + GAP_PX;
    for (let index = from; index < count; index += 1) {
      if (this.starts[index] !== offset) {
        this.starts[index] = offset;
        moved = true;
      }
      offset += (this.extents[index] as number) + GAP_PX;
    }
    this.height = Math.max(0, offset - GAP_PX);
    if (moved) this.revision += 1;
  }

  private prune(): void {
    if (this.sizes.size > this.lines.length * 2 + 64) {
      const live = new Set(this.lines.map((line) => line.key));
      for (const key of [...this.sizes.keys()]) if (!live.has(key)) this.sizes.delete(key);
    }
    if (this.hints.size > this.lines.length * 2 + 64) this.hints.clear();
    if (this.attachments.size > this.lines.length * 2 + 64) {
      const live = new Set(this.lines.map((line) => line.key));
      for (const key of [...this.attachments.keys()]) if (!live.has(key)) this.attachments.delete(key);
    }
  }

  private sizeOf(line: T): number {
    return this.sizes.get(line.key) ?? this.estimate(line);
  }

  private lineAt(offset: number): number {
    const starts = this.starts;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((starts[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  private anchor(): { readonly key: string; readonly into: number } | null {
    const scroller = this.scroller;
    if (scroller === null || scroller.scrollTop <= this.margin || this.lines.length === 0) return null;
    const index = this.lineAt(scroller.scrollTop - this.margin);
    const line = this.lines[index];
    return line === undefined ? null : { key: line.key, into: scroller.scrollTop - this.margin - (this.starts[index] ?? 0) };
  }

  private restore(anchor: { readonly key: string; readonly into: number }): void {
    const index = this.indexFor(anchor.key);
    const scroller = this.scroller;
    if (index < 0 || scroller === null) return;
    const wanted = (this.starts[index] ?? 0) + anchor.into + this.margin;
    if (Math.abs(scroller.scrollTop - wanted) > 0.5) scroller.scrollTop = wanted;
    this.top = scroller.scrollTop;
  }
}
