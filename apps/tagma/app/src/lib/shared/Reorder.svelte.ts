import { flushSync } from 'svelte';
import { flip } from 'svelte/animate';
import type { Attachment } from 'svelte/attachments';
import { edgeScroll } from './edgeScroll.js';
import { lift, type Point } from './lift.js';

export type Axis = 'x' | 'y';

export type Beyond<K> = {
  readonly follow: (id: K | null, at: Point) => void;
  readonly drop: (id: K) => boolean;
};

type Press<K> = {
  readonly id: K;
  readonly at: Point;
  readonly scroll: number;
  readonly start: number;
  readonly from: HTMLElement;
  readonly add: ((id: K, before: K | null) => void) | null;
};

const THRESHOLD_PX = 4;
const GLIDE_MS = 150;
const CONTROLS = 'button, a, input, textarea, select';
const HANDLE = '[data-reorder-handle]';
const OVER = 'data-reorder-over';

export const glide = (node: Element, rects: { from: DOMRect; to: DOMRect }) =>
  node instanceof HTMLElement && node.dataset.carried !== undefined ? { duration: 0 } : flip(node, rects, { duration: GLIDE_MS });

export class Reorder<K extends string | number> {
  private held = $state<K | null>(null);
  private entering = $state<K | null>(null);
  private aimed = $state.raw<HTMLElement | null>(null);
  private order = $state.raw<readonly K[] | null>(null);
  private shifted = $state(0);

  private list: HTMLElement | null = null;
  private press: Press<K> | null = null;
  private pointer: Point = { x: 0, y: 0 };
  private frame = 0;
  private away = false;
  private release: (() => void) | null = null;
  private readonly outlets = new Map<HTMLElement, (id: K) => void>();

  constructor(
    private readonly ids: () => readonly K[],
    private readonly move: (id: K, before: K | null) => void,
    private readonly axis: Axis,
    private readonly beyond?: Beyond<K>,
  ) {}

  get carried(): K | null {
    return this.held;
  }

  get incoming(): K | null {
    return this.entering;
  }

  get leaving(): boolean {
    return this.aimed !== null;
  }

  arranged<T>(items: readonly T[], keyOf: (item: T) => K): readonly T[] {
    const order = this.order;
    if (order === null) return items;
    const rank = new Map(order.map((id, at) => [id, at]));
    return [...items].sort((a, b) => (rank.get(keyOf(a)) ?? order.length) - (rank.get(keyOf(b)) ?? order.length));
  }

  offset(id: K): string | undefined {
    if (id !== this.held) return undefined;
    return this.axis === 'y' ? `0 ${this.shifted}px` : `${this.shifted}px 0`;
  }

  readonly attach = (list: HTMLElement): (() => void) => {
    this.list = list;
    const down = (event: PointerEvent): void => {
      const id = this.handled(event, list, this.ids);
      const node = id === undefined ? undefined : this.items().get(String(id));
      if (id === undefined || node === undefined) return;
      this.pressed(event, id, list, this.startOf(node), null);
    };
    const scrolled = (): void => {
      if (this.held !== null) this.aim();
    };
    const unlisten = this.listen(list, down);
    list.addEventListener('scroll', scrolled);
    return () => {
      this.release?.();
      unlisten();
      list.removeEventListener('scroll', scrolled);
      if (this.list === list) this.list = null;
    };
  };

  inlet(ids: () => readonly K[], add: (id: K, before: K | null) => void): Attachment<HTMLElement> {
    return (source) => {
      const down = (event: PointerEvent): void => {
        const id = this.list === null ? undefined : this.handled(event, source, ids);
        if (id !== undefined) this.pressed(event, id, source, 0, add);
      };
      const unlisten = this.listen(source, down);
      return () => {
        if (this.press?.from === source) this.release?.();
        unlisten();
      };
    };
  }

  outlet(remove: (id: K) => void): Attachment<HTMLElement> {
    return (element) => {
      this.outlets.set(element, remove);
      return () => {
        this.outlets.delete(element);
        if (this.aimed === element) this.over(null);
      };
    };
  }

  private listen(element: HTMLElement, down: (event: PointerEvent) => void): () => void {
    const native = (event: DragEvent): void => {
      if (event.target instanceof Element && event.target.closest(HANDLE) !== null) event.preventDefault();
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('dragstart', native);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('dragstart', native);
    };
  }

  private handled(event: PointerEvent, within: HTMLElement, ids: () => readonly K[]): K | undefined {
    if (event.button !== 0 || this.held !== null || !(event.target instanceof Element)) return undefined;
    const handle = event.target.closest<HTMLElement>(HANDLE);
    if (handle === null || !within.contains(handle)) return undefined;
    const control = event.target.closest(CONTROLS);
    if (control !== null && control !== handle && handle.contains(control)) return undefined;
    return ids().find((id) => String(id) === handle.dataset.reorderHandle);
  }

  private pressed(event: PointerEvent, id: K, from: HTMLElement, start: number, add: Press<K>['add']): void {
    this.release?.();
    const press: Press<K> = { id, at: { x: event.clientX, y: event.clientY }, scroll: this.scroll(), start, from, add };
    this.press = press;
    const along = add === null && this.beyond === undefined;
    this.release = lift(event, {
      threshold: THRESHOLD_PX,
      distance: (at, to) =>
        along ? Math.abs(this.along(to) - this.along(at) + this.scroll() - press.scroll) : Math.hypot(to.x - at.x, to.y - at.y),
      lift: (at, moved) => {
        this.pointer = at;
        this.held = id;
        if (add === null) this.order = this.ids();
        from.setPointerCapture(moved.pointerId);
        this.frame = requestAnimationFrame(this.drift);
        return true;
      },
      move: (at) => {
        this.pointer = at;
        this.aim();
      },
      drop: () => this.up(press),
      cancel: () => this.end(),
    });
  }

  private aim(): void {
    const held = this.press;
    const list = this.list;
    if (held === null || list === null) return;
    if (held.add === null) {
      const node = this.items().get(String(held.id));
      if (node === undefined) return;
      const outlet = this.outletAt();
      this.over(outlet);
      this.away = this.beyond !== undefined && outlet === null && !this.within(list);
      this.beyond?.follow(this.away ? held.id : null, this.pointer);
      if (this.away) {
        this.restore();
        this.shifted = held.start - this.startOf(node);
        return;
      }
      const delta = this.along(this.pointer) - this.along(held.at) + this.scroll() - held.scroll;
      this.rank(held.id, held.start + this.sizeOf(node) / 2 + delta);
      this.shifted = held.start + delta - this.startOf(node);
      return;
    }
    if (!this.within(list)) {
      this.entering = null;
      this.order = null;
      this.shifted = 0;
      return;
    }
    const center = this.along(this.pointer) - this.origin(list);
    this.entering = this.ids().includes(held.id) ? null : held.id;
    this.rank(held.id, center);
    const node = this.items().get(String(held.id));
    this.shifted = node === undefined ? 0 : center - this.sizeOf(node) / 2 - this.startOf(node);
  }

  private restore(): void {
    const ids = this.ids();
    if (this.order !== null && this.order.length === ids.length && this.order.every((id, at) => id === ids[at])) return;
    this.order = ids;
    flushSync();
  }

  private rank(id: K, center: number): void {
    const nodes = this.items();
    const others = (this.order ?? this.ids()).filter((one) => one !== id);
    let at = 0;
    for (const one of others) {
      const other = nodes.get(String(one));
      if (other !== undefined && this.startOf(other) + this.sizeOf(other) / 2 < center) at += 1;
    }
    const next = [...others.slice(0, at), id, ...others.slice(at)];
    if (this.order === null || next.some((one, place) => one !== this.order?.[place])) {
      this.order = next;
      flushSync();
    }
  }

  private readonly drift = (): void => {
    const list = this.list;
    if (list !== null && !this.away && (this.press?.add === null || this.order !== null)) {
      const box = list.getBoundingClientRect();
      const speed = this.axis === 'y' ? edgeScroll(this.pointer.y, box.top, box.bottom) : edgeScroll(this.pointer.x, box.left, box.right);
      if (speed !== 0 && this.axis === 'y') list.scrollTop += speed;
      else if (speed !== 0) list.scrollLeft += speed;
    }
    this.frame = requestAnimationFrame(this.drift);
  };

  private up(held: Press<K>): void {
    if (this.held === null) return;
    const order = this.order;
    const remove = this.aimed === null ? undefined : this.outlets.get(this.aimed);
    const away = this.away;
    const ids = this.ids();
    if (away && this.beyond?.drop(held.id)) {
      this.away = false;
      this.end();
      return;
    }
    this.end();
    if (held.add === null && remove !== undefined) return remove(held.id);
    if (away) return;
    if (order === null) return;
    const kept = order.length === ids.length && order.every((id, at) => id === ids[at]);
    if (kept) return;
    const before = order[order.indexOf(held.id) + 1] ?? null;
    if (held.add === null) this.move(held.id, before);
    else held.add(held.id, before);
  }

  private end(): void {
    this.press = null;
    this.release = null;
    cancelAnimationFrame(this.frame);
    if (this.away) this.beyond?.follow(null, this.pointer);
    this.away = false;
    this.held = null;
    this.entering = null;
    this.order = null;
    this.shifted = 0;
    this.over(null);
  }

  private over(outlet: HTMLElement | null): void {
    if (outlet === this.aimed) return;
    this.aimed?.removeAttribute(OVER);
    outlet?.setAttribute(OVER, '');
    this.aimed = outlet;
  }

  private outletAt(): HTMLElement | null {
    const { x, y } = this.pointer;
    for (const outlet of this.outlets.keys()) {
      const box = outlet.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return outlet;
    }
    return null;
  }

  private within(list: HTMLElement): boolean {
    const box = list.getBoundingClientRect();
    const { x, y } = this.pointer;
    return this.axis === 'y' ? x >= box.left && x <= box.right : y >= box.top && y <= box.bottom;
  }

  private origin(list: HTMLElement): number {
    const first = list.querySelector<HTMLElement>('[data-reorder-item]');
    const frame = first?.offsetParent instanceof HTMLElement ? first.offsetParent : list;
    const box = frame.getBoundingClientRect();
    return this.axis === 'y' ? box.top + frame.clientTop - frame.scrollTop : box.left + frame.clientLeft - frame.scrollLeft;
  }

  private items(): Map<string, HTMLElement> {
    const list = this.list;
    if (list === null) return new Map();
    return new Map(
      [...list.querySelectorAll<HTMLElement>('[data-reorder-item]')].map((node) => [node.dataset.reorderItem ?? '', node] as const),
    );
  }

  private along(point: Point): number {
    return this.axis === 'y' ? point.y : point.x;
  }

  private scroll(): number {
    const list = this.list;
    if (list === null) return 0;
    return this.axis === 'y' ? list.scrollTop : list.scrollLeft;
  }

  private startOf(node: HTMLElement): number {
    return this.axis === 'y' ? node.offsetTop : node.offsetLeft;
  }

  private sizeOf(node: HTMLElement): number {
    return this.axis === 'y' ? node.offsetHeight : node.offsetWidth;
  }
}
