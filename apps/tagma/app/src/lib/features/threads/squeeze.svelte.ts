import type { Attachment } from 'svelte/attachments';

export const Stow = { place: 1, effort: 2, model: 3, ring: 4, files: 5, plate: 6 } as const;

export const STOWED = 'pointer-events-none invisible absolute right-0 w-max';

const TOP = Stow.plate;
const TITLE_EM = 5.5;

type Frame = { readonly end: number; readonly gap: number; readonly title: number };

type Need = { readonly depth: number; readonly need: number };

export class Squeeze {
  private steps = $state<readonly number[]>([]);
  private root: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private everything = false;
  private readonly needs = new Map<HTMLElement, Need>();
  private readonly stale = new Set<HTMLElement>();
  private readonly rowOf = new WeakMap<Element, HTMLElement>();
  private readonly gaps = new WeakMap<Element, number>();

  step(depth: number): number {
    const steps = this.steps;
    return steps.length === 0 ? 0 : (steps[Math.min(depth, steps.length - 1)] ?? 0);
  }

  readonly column: Attachment<HTMLElement> = (root) => {
    this.root = root;
    this.remeasureAll();
    void document.fonts.ready.then(() => this.remeasureAll());
    return () => {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.observer?.disconnect();
      this.observer = null;
      this.root = null;
      this.needs.clear();
      this.stale.clear();
    };
  };

  readonly row: Attachment<HTMLElement> = (row) => {
    const parts = [row.querySelector('[data-squeeze-cluster]'), row.querySelector('[data-squeeze-title]')].filter(
      (part): part is Element => part !== null,
    );
    const observer = this.watch();
    observer.observe(row);
    for (const part of parts) {
      this.rowOf.set(part, row);
      observer.observe(part);
    }
    this.stale.add(row);
    this.schedule();
    return () => {
      this.observer?.unobserve(row);
      for (const part of parts) this.observer?.unobserve(part);
      this.needs.delete(row);
      this.stale.delete(row);
      this.schedule();
    };
  };

  private watch(): ResizeObserver {
    return (this.observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) this.stale.add(this.rowOf.get(entry.target) ?? (entry.target as HTMLElement));
      this.schedule();
    }));
  }

  private remeasureAll(): void {
    this.everything = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  private measure(): void {
    const root = this.root;
    if (root === null) return;
    if (this.everything) {
      this.everything = false;
      for (const row of root.querySelectorAll<HTMLElement>('[data-squeeze-depth]')) this.stale.add(row);
    }
    let frame: Frame | null = null;
    for (const row of this.stale) {
      const room = row.querySelector('[data-squeeze-room]');
      const title = row.querySelector('[data-squeeze-title]');
      const cluster = row.querySelector('[data-squeeze-cluster]');
      if (!row.isConnected || !root.contains(row) || room === null || title === null || cluster === null) {
        this.needs.delete(row);
        continue;
      }
      frame ??= frameOf(row);
      const space = row.getBoundingClientRect().right - frame.end - room.getBoundingClientRect().left - frame.gap;
      let kept = 0;
      for (const piece of room.querySelectorAll('[data-squeeze-keep]')) kept += piece.getBoundingClientRect().width + this.gapOf(room);
      const free = space - Math.min(title.scrollWidth, frame.title) - kept;
      this.needs.set(row, {
        depth: Number(row.dataset.squeezeDepth),
        need: this.needOf(cluster, Number(row.dataset.squeezeStep ?? 0), free),
      });
    }
    this.stale.clear();
    const need: number[] = [];
    for (const held of this.needs.values()) need[held.depth] = Math.max(need[held.depth] ?? 0, held.need);
    const steps: number[] = [];
    let floor = 0;
    for (let depth = 0; depth < need.length; depth++) {
      floor = Math.max(floor, need[depth] ?? 0);
      steps.push(floor);
    }
    const now = this.steps;
    if (steps.length !== now.length || steps.some((step, depth) => step !== now[depth])) this.steps = steps;
  }

  private needOf(cluster: Element, applied: number, free: number): number {
    const byStep = new Array<number>(TOP + 1).fill(0);
    const nested = new Map<Element, number>();
    let shown = 0;
    for (const piece of [...cluster.querySelectorAll<HTMLElement>('[data-squeeze-piece]')].reverse()) {
      const rank = Number(piece.dataset.squeezePiece);
      const share = piece.getBoundingClientRect().width - (nested.get(piece) ?? 0) + this.gapOf(piece.parentElement);
      byStep[rank] = (byStep[rank] ?? 0) + share;
      if (rank <= applied) continue;
      shown += share;
      const holder = piece.parentElement?.closest('[data-squeeze-piece]');
      if (holder !== null && holder !== undefined && cluster.contains(holder)) nested.set(holder, (nested.get(holder) ?? 0) + share);
    }
    let demand = cluster.getBoundingClientRect().width - shown + byStep.reduce((sum, share) => sum + share, 0);
    for (let step = 0; step <= TOP; step++) {
      demand -= byStep[step] ?? 0;
      if (demand <= free + 0.5) return step;
    }
    return TOP;
  }

  private gapOf(parent: Element | null): number {
    if (parent === null) return 0;
    let gap = this.gaps.get(parent);
    if (gap === undefined) {
      gap = parseFloat(getComputedStyle(parent).columnGap) || 0;
      this.gaps.set(parent, gap);
    }
    return gap;
  }
}

function frameOf(row: HTMLElement): Frame {
  const style = getComputedStyle(row);
  return { end: parseFloat(style.paddingRight), gap: parseFloat(style.columnGap), title: parseFloat(style.fontSize) * TITLE_EM };
}
