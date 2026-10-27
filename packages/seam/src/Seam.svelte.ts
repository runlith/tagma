import { clamp } from '@runlith/utils/number';
import { untrack } from 'svelte';

export type SeamAxis = 'x' | 'y';

export type SeamSide = 'start' | 'end';

const STEP_PX = 16;

export type SeamPane = {
  readonly axis?: SeamAxis;
  readonly side?: SeamSide;
  readonly size?: number;
  readonly base: number;
  readonly min: number;
  readonly max: number;
  readonly share?: number;
  readonly fill?: number;
  readonly rest?: number;
  readonly step?: number;
};

export type SeamReport = {
  onGrab?(): () => void;
  onDrag?(size: number, fill: number): void;
  onCommit?(size: number, fill: number): void;
  onCollapse?(): void;
  onReset?(): void;
};

type Gesture = {
  readonly pointerId: number;
  readonly from: number;
  readonly fill: number;
  readonly at: number;
  readonly release: (() => void) | undefined;
  readonly grip: object | undefined;
};

export class Seam {
  dragging = $state(false);
  willCollapse = $state(false);

  private pointers = $state(0);
  private wish = $state(0);
  private sized = $state(false);
  private viewport = $state(0);
  private box: HTMLElement | undefined;
  private gap = 0;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private userSelect = '';
  private cursor = '';

  constructor(
    private readonly pane: SeamPane,
    private readonly report: SeamReport = {},
  ) {
    this.wish = pane.size ?? pane.base;
    this.sized = pane.size !== undefined || pane.fill === undefined;
    this.measure();
  }

  get size(): number {
    const wish = this.dragging || (this.sized && !this.split) ? this.wish : this.filled;
    return clamp(Math.round(wish), this.floor, this.ceiling);
  }

  get axis(): SeamAxis {
    return this.pane.axis ?? 'x';
  }

  get side(): SeamSide {
    return this.pane.side ?? 'end';
  }

  get hovered(): boolean {
    return this.pointers > 0;
  }

  get min(): number {
    return this.floor;
  }

  get max(): number {
    return this.ceiling;
  }

  measure(): void {
    if (typeof window === 'undefined') return;
    const box = this.box;
    if (box !== undefined) this.viewport = Math.max(0, (this.axis === 'x' ? box.clientWidth : box.clientHeight) - this.gap);
    else this.viewport = this.axis === 'x' ? window.innerWidth : window.innerHeight;
  }

  contain(box: HTMLElement, gap = 0): () => void {
    this.box = box;
    this.gap = gap;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.measure());
    observer?.observe(box);
    this.measure();
    return () => {
      observer?.disconnect();
      if (this.box !== box) return;
      this.box = undefined;
      this.gap = 0;
      this.measure();
    };
  }

  grab(event: PointerEvent, grip?: object): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.measure();
    this.cancel();
    const from = this.size;
    const fill = !this.sized || this.split ? (this.pane.fill ?? this.fillOf(from)) : this.fillOf(from);
    this.gesture = { pointerId: event.pointerId, from, fill, at: this.along(event), release: this.report.onGrab?.(), grip };
    this.wish = from;
    this.dragging = true;
    this.userSelect = document.body.style.userSelect;
    this.cursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = this.axis === 'x' ? 'col-resize' : 'row-resize';
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onRelease, true);
    window.addEventListener('pointercancel', this.onAbandon, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('blur', this.onBlur);
  }

  key(event: KeyboardEvent): void {
    this.measure();
    const back = this.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = this.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const sign = this.side === 'end' ? 1 : -1;
    const step = this.pane.step ?? STEP_PX;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.reset();
      return;
    }
    const asked =
      event.key === back
        ? this.size - sign * step
        : event.key === forward
          ? this.size + sign * step
          : event.key === 'Home'
            ? this.floor
            : event.key === 'End'
              ? this.ceiling
              : null;
    if (asked === null) return;
    event.preventDefault();
    this.settle(asked);
  }

  reset(): void {
    this.measure();
    if (this.pane.fill === undefined) this.settle(this.pane.base);
    else this.sized = false;
    this.report.onReset?.();
  }

  point(): () => void {
    untrack(() => (this.pointers += 1));
    let pointed = true;
    return () => {
      if (!pointed) return;
      pointed = false;
      untrack(() => (this.pointers -= 1));
    };
  }

  dispose(grip?: object): void {
    if (grip !== undefined && this.gesture?.grip !== grip) return;
    this.cancel();
  }

  private get split(): boolean {
    return this.pane.rest !== undefined;
  }

  private get floor(): number {
    const rest = this.pane.rest;
    if (rest === undefined || this.viewport <= 0) return this.pane.min;
    return Math.min(this.pane.min, (this.viewport * this.pane.min) / (this.pane.min + rest));
  }

  private get ceiling(): number {
    const share = this.pane.share;
    const rest = this.pane.rest;
    let capped = this.pane.max;
    if (this.viewport > 0 && share !== undefined) capped = Math.min(capped, Math.round(this.viewport * share));
    if (this.viewport > 0 && rest !== undefined) capped = Math.min(capped, this.viewport - rest);
    return Math.max(this.floor, capped);
  }

  private get filled(): number {
    const fill = this.pane.fill;
    return fill !== undefined && this.viewport > 0 ? this.viewport * fill : this.pane.base;
  }

  private fillOf(size: number): number {
    return this.viewport > 0 ? size / this.viewport : (this.pane.fill ?? 0);
  }

  private along(event: PointerEvent): number {
    return this.axis === 'x' ? event.clientX : event.clientY;
  }

  private settle(asked: number): void {
    const size = clamp(Math.round(asked), this.floor, this.ceiling);
    this.wish = size;
    this.sized = true;
    this.report.onCommit?.(size, this.fillOf(size));
  }

  private onMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const travel = this.along(event) - gesture.at;
    const asked = gesture.from + (this.side === 'end' ? travel : -travel);
    this.willCollapse = this.report.onCollapse !== undefined && asked < this.pane.min / 2;
    this.wish = clamp(asked, this.floor, this.ceiling);
    if (this.report.onDrag === undefined || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const size = this.size;
      this.report.onDrag?.(size, this.fillOf(size));
    });
  };

  private onRelease = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const landed = this.size;
    const collapsing = this.willCollapse;
    this.end();
    if (collapsing) this.report.onCollapse?.();
    else {
      this.wish = landed;
      this.sized = true;
      this.report.onCommit?.(landed, this.fillOf(landed));
    }
    gesture.release?.();
  };

  private onAbandon = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.cancel();
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.gesture === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  private onBlur = (): void => {
    this.cancel();
  };

  private cancel(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.end();
    this.wish = gesture.from;
    this.report.onDrag?.(gesture.from, gesture.fill);
    gesture.release?.();
  }

  private end(): void {
    this.gesture = undefined;
    this.dragging = false;
    this.willCollapse = false;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    document.body.style.userSelect = this.userSelect;
    document.body.style.cursor = this.cursor;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onRelease, true);
    window.removeEventListener('pointercancel', this.onAbandon, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('blur', this.onBlur);
  }
}
