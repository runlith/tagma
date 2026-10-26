import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import { listen } from './dismissal.js';
import type { Float } from './float.svelte.js';
import { focusSafely } from './focus.js';
import type { OverlayLayer } from './layer.svelte.js';
import { layers } from './layers.js';
import type { Rect } from './place.js';
import { Tracking } from './tracking.js';

const FLOOR = layers.stack + 1;
const CEILING = layers.notice - 1;

export const SURFACE_ATTRIBUTE = 'data-overlay-surface';

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function same(left: readonly Rect[], right: readonly Rect[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((rect, index) => {
    const other = right[index]!;
    return rect.x === other.x && rect.y === other.y && rect.width === other.width && rect.height === other.height;
  });
}

export class OverlayLayers {
  rects = $state.raw<readonly Rect[]>([]);

  private readonly open: OverlayLayer[] = [];
  private readonly seats = new Map<OverlayLayer, number>();
  private next = FLOOR;
  private readonly floats = new Set<Float>();
  private readonly notices = new Set<HTMLElement>();
  private readonly intents = new Set<() => void>();
  private readonly tracking = new Tracking(() => this.follow());
  private unlisten: (() => void) | undefined;
  private frame = 0;
  private returning = false;

  get restoring(): boolean {
    return this.returning;
  }

  restore(target: HTMLElement): void {
    this.returning = true;
    try {
      focusSafely(target);
    } finally {
      this.returning = false;
    }
  }

  enter(layer: OverlayLayer): number {
    const at = this.open.indexOf(layer);
    if (at !== -1) this.open.splice(at, 1);
    this.open.push(layer);
    this.unlisten ??= listen(this);
    const z = this.seat(layer);
    this.project();
    return z;
  }

  leave(layer: OverlayLayer): void {
    const at = this.open.indexOf(layer);
    if (at === -1) return;
    this.open.splice(at, 1);
    if (this.open.length === 0) {
      this.unlisten?.();
      this.unlisten = undefined;
    }
    this.project();
  }

  vacate(layer: OverlayLayer): void {
    if (!this.seats.delete(layer)) return;
    let top = FLOOR - 1;
    for (const z of this.seats.values()) top = Math.max(top, z);
    this.next = top + 1;
  }

  layers(): readonly OverlayLayer[] {
    return [...this.open];
  }

  top(): OverlayLayer | undefined {
    return this.open.findLast((layer) => layer.dismissable);
  }

  topModal(): OverlayLayer | undefined {
    return this.open.findLast((layer) => layer.modal);
  }

  descendants(layer: OverlayLayer): readonly OverlayLayer[] {
    return this.open.filter((other) => {
      for (let above = other.parent; above !== undefined; above = above.parent) if (above === layer) return true;
      return false;
    });
  }

  holding(node: Node): ReadonlySet<OverlayLayer> {
    const held = new Set<OverlayLayer>();
    for (const layer of this.open) {
      if (!layer.owns(node)) continue;
      for (let up: OverlayLayer | undefined = layer; up !== undefined && !held.has(up); up = up.parent) held.add(up);
    }
    return held;
  }

  intend(): void {
    for (const listener of [...this.intents]) listener();
  }

  onIntent(listener: () => void): () => void {
    this.intents.add(listener);
    return () => this.intents.delete(listener);
  }

  readonly notice: Attachment<HTMLElement> = (element) => {
    element.setAttribute(SURFACE_ATTRIBUTE, '');
    this.notices.add(element);
    const unwatch = this.tracking.watch(element);
    this.project();
    return () => {
      unwatch();
      this.notices.delete(element);
      this.project();
    };
  };

  watch(element: Element): () => void {
    const unwatch = this.tracking.watch(element);
    this.project();
    return () => {
      unwatch();
      this.project();
    };
  }

  track(float: Float, floating: Element, anchor: Element | undefined): () => void {
    this.floats.add(float);
    const unwatch = this.tracking.watch(floating);
    const unfollow = anchor === undefined ? undefined : this.tracking.follow(anchor);
    return () => {
      unfollow?.();
      unwatch();
      this.floats.delete(float);
    };
  }

  private follow(): void {
    untrack(() => {
      for (const float of [...this.floats]) float.update();
    });
    this.project();
  }

  private seat(layer: OverlayLayer): number {
    const held = this.seats.get(layer);
    if (held !== undefined && held === this.next - 1) return held;
    this.vacate(layer);
    if (this.next > CEILING) this.compact();
    const z = Math.min(this.next, CEILING);
    this.next = z + 1;
    this.seats.set(layer, z);
    return z;
  }

  private compact(): void {
    const order = [...this.seats].sort((left, right) => left[1] - right[1]);
    order.forEach(([layer], index) => {
      const z = FLOOR + index;
      this.seats.set(layer, z);
      layer.z = z;
    });
    this.next = FLOOR + order.length;
  }

  private project(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  private measure(): void {
    const rects: Rect[] = [];
    for (const layer of this.open) for (const element of layer.elements) rects.push(rectOf(element));
    for (const element of this.notices) rects.push(rectOf(element));
    if (
      !same(
        rects,
        untrack(() => this.rects),
      )
    )
      this.rects = rects;
  }
}

export const overlayLayers = new OverlayLayers();
