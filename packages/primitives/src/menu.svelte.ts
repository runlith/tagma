import { getContext, onDestroy, setContext, untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import { Collection } from './collection.svelte.js';
import { Float, type Anchor } from './float.svelte.js';
import { focusSafely, namedFocusIn } from './focus.js';
import { OverlayLayer, type DismissReason, type ReturnFocus } from './layer.svelte.js';
import type { PlaceOptions, Point } from './place.js';

export interface MenuConduct extends PlaceOptions {
  readonly anchor?: Anchor;
  readonly returnFocus?: ReturnFocus;
  readonly dismissOnFocusOutside?: boolean;
}

export interface MenuEntry {
  readonly disabled?: boolean;
  readonly textValue?: string;
}

export interface MenuItem extends MenuEntry {
  readonly closeOnSelect?: boolean;
  readonly onSelect?: (event: Event) => void;
}

type Entry = 'first' | 'content' | 'none';

interface Aim {
  readonly sub: Menu;
  readonly apex: Point;
  over: EventTarget | null;
}

const CONTEXT = Symbol.for('@runlith/primitives/menu');
const REST_MS = 150;
const APEX_PX = 5;
const OPENING_KEYS = new Set(['Enter', ' ', 'ArrowDown']);

const within = (box: DOMRect, point: Point): boolean =>
  point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

const cross = (a: Point, b: Point, p: Point): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const ab = cross(a, b, p);
  const bc = cross(b, c, p);
  const ca = cross(c, a, p);
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

function onPath(point: Point, apex: Point, box: DOMRect): boolean {
  const edge = box.left >= apex.x ? box.left : box.right;
  return inTriangle(point, apex, { x: edge, y: box.top }, { x: edge, y: box.bottom });
}

export class Menu {
  conduct: () => MenuConduct = () => ({});
  readonly collection: Collection;

  private readonly subs = new Set<Menu>();
  private entry: Entry = 'content';
  private dragging = false;
  private aim: Aim | null = null;
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private contentElement = $state.raw<HTMLElement | null>(null);
  private openings = $state(0);
  private subTriggerElement: HTMLElement | null = null;

  constructor(
    readonly id: string,
    readonly parent: Menu | undefined,
    readonly layer: OverlayLayer,
    readonly float: Float,
    private readonly opened: () => boolean,
    private readonly change: (open: boolean) => void,
  ) {
    this.collection = new Collection(() => ({ highlighting: 'focus', loop: true, tracksPointer: () => this.aim === null }));
    $effect.pre(() => {
      const open = this.opened();
      untrack(() => {
        if (!open) return this.layer.close();
        this.layer.open();
        this.openings += 1;
      });
    });
    $effect(() => {
      const highlighted = this.collection.highlighted;
      untrack(() => this.release(highlighted));
    });
    $effect(() => {
      this.contentElement?.setAttribute('data-state', this.opened() ? 'open' : 'closed');
    });
  }

  static root(id: string, open: () => boolean, change: (open: boolean) => void): Menu {
    return Menu.build(id, undefined, open, change);
  }

  static sub(id: string, open: () => boolean, change: (open: boolean) => void): Menu {
    const parent = getContext<Menu | undefined>(CONTEXT);
    if (parent === undefined) throw new Error('A submenu stands outside a menu');
    const sub = Menu.build(id, parent, open, change);
    parent.subs.add(sub);
    onDestroy(() => parent.subs.delete(sub));
    return sub;
  }

  static use(): Menu {
    const menu = getContext<Menu | undefined>(CONTEXT);
    if (menu === undefined) throw new Error('A menu part stands outside a menu');
    return menu;
  }

  private static build(id: string, parent: Menu | undefined, open: () => boolean, change: (open: boolean) => void): Menu {
    const layer = OverlayLayer.make((reason) => menu.dismiss(reason), { returnFocus: () => menu.conduct().returnFocus });
    const float = Float.make(
      layer,
      () => menu.anchor,
      () => {
        const conduct = menu.conduct();
        if (parent === undefined) return conduct;
        return { ...conduct, side: conduct.side ?? 'right', align: conduct.align ?? 'start' };
      },
    );
    const menu = new Menu(id, parent, layer, float, open, change);
    setContext(CONTEXT, menu);
    onDestroy(() => menu.endAim());
    return menu;
  }

  get open(): boolean {
    return this.opened();
  }

  get root(): Menu {
    return this.parent?.root ?? this;
  }

  get labelledBy(): string | undefined {
    return this.layer.triggerElement?.id || undefined;
  }

  get anchor(): Anchor | undefined {
    return this.conduct().anchor ?? this.subTriggerElement ?? this.layer.triggerElement ?? undefined;
  }

  close(reason?: DismissReason): void {
    this.change(false);
    if (!this.opened()) this.layer.close(reason);
  }

  readonly trigger: Attachment<HTMLElement> = (element) => {
    element.id ||= `${this.id}-trigger`;
    const leave = this.layer.trigger(element);
    let pointer = '';
    const press = (event: PointerEvent): void => {
      pointer = event.pointerType;
      if (pointer !== 'mouse' || event.button !== 0 || event.ctrlKey) return;
      if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      if (this.opened()) return this.close();
      this.drag();
      this.show('content');
    };
    const click = (event: MouseEvent): void => {
      const byMouse = event.detail !== 0 && pointer === 'mouse';
      pointer = '';
      if (byMouse) return;
      if (this.opened()) this.close();
      else this.show('content');
    };
    const key = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !OPENING_KEYS.has(event.key)) return;
      event.preventDefault();
      this.show('first');
    };
    element.addEventListener('pointerdown', press);
    element.addEventListener('click', click);
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('click', click);
      element.removeEventListener('keydown', key);
      if (typeof leave === 'function') leave();
    };
  };

  subTrigger(options: () => MenuEntry): Attachment<HTMLElement> {
    const parent = this.parent;
    if (parent === undefined) throw new Error('A sub trigger stands outside a submenu');
    const item = parent.collection.item(() => ({
      disabled: options().disabled,
      textValue: options().textValue,
      onSelect: (event) => {
        this.layer.prime(event instanceof KeyboardEvent ? 'keyboard' : 'pointer');
        this.show('first');
      },
    }));
    return (element) => {
      element.id ||= `${this.id}-trigger`;
      this.subTriggerElement = element;
      this.layer.triggerElement = element;
      const hover = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch' && untrack(options).disabled !== true) this.reach();
      };
      const leave = (event: PointerEvent): void => {
        if (this.opened() && event.pointerType !== 'touch') parent.aimAt(this, event);
      };
      const key = (event: KeyboardEvent): void => {
        if (event.key !== 'ArrowRight' || untrack(options).disabled === true) return;
        event.preventDefault();
        if (this.opened()) return this.enter('first');
        this.layer.prime('keyboard');
        this.show('first');
      };
      element.addEventListener('pointerleave', leave);
      element.addEventListener('pointermove', hover);
      element.addEventListener('keydown', key);
      const unitem = item(element);
      return () => {
        element.removeEventListener('pointerleave', leave);
        element.removeEventListener('pointermove', hover);
        element.removeEventListener('keydown', key);
        if (typeof unitem === 'function') unitem();
        if (this.subTriggerElement === element) this.subTriggerElement = null;
        if (this.layer.triggerElement === element) this.layer.triggerElement = null;
      };
    };
  }

  readonly content: Attachment<HTMLElement> = (element) => {
    this.contentElement = element;
    let given = 0;
    $effect(() => {
      const opening = this.openings;
      if (opening === given || !this.opened() || this.float.placement === undefined) return;
      given = opening;
      untrack(() => this.enter(this.entry));
    });
    const leave = this.layer.surface(element);
    const unfloat = this.float.floating(element);
    const unfield = this.collection.field(element);
    const key = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === 'Tab') this.leaveByTab();
      else if (event.key === 'ArrowLeft' && this.parent !== undefined) {
        event.preventDefault();
        this.close();
      }
    };
    const filter = (event: KeyboardEvent): void => {
      const field = this.filterField();
      if (field === null || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target === field) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        this.collection.highlight(event.key === 'ArrowDown' ? this.collection.first() : this.collection.last());
        return;
      }
      if ([...event.key].length !== 1 && event.key !== 'Backspace') return;
      event.stopImmediatePropagation();
      focusSafely(field);
    };
    element.addEventListener('keydown', filter, true);
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('keydown', filter, true);
      element.removeEventListener('keydown', key);
      if (typeof unfield === 'function') unfield();
      if (typeof unfloat === 'function') unfloat();
      if (typeof leave === 'function') leave();
      if (this.contentElement === element) this.contentElement = null;
    };
  };

  item(options: () => MenuItem): Attachment<HTMLElement> {
    const item = this.collection.item(() => ({
      disabled: options().disabled,
      textValue: options().textValue,
      onSelect: (event) => this.choose(options, event),
    }));
    return (element) => {
      const release = (event: PointerEvent): void => {
        if (event.button === 0 && this.root.dragging) this.choose(options, event);
      };
      element.addEventListener('pointerup', release);
      const unitem = item(element);
      return () => {
        element.removeEventListener('pointerup', release);
        if (typeof unitem === 'function') unitem();
      };
    };
  }

  private show(entry: Entry): void {
    this.entry = entry;
    this.change(true);
  }

  private reach(): void {
    if (this.opened() || this.parent?.aim !== null) return;
    this.layer.prime('pointer');
    this.show('none');
  }

  private filterField(): HTMLInputElement | null {
    const named = this.contentElement === null ? null : namedFocusIn(this.contentElement);
    return named instanceof HTMLInputElement ? named : null;
  }

  private enter(entry: Entry): void {
    this.entry = 'content';
    const field = entry === 'none' ? null : this.filterField();
    if (field !== null) focusSafely(field);
    else if (entry === 'first') this.collection.highlight(this.collection.first());
    else if (entry === 'content' && this.contentElement !== null) focusSafely(this.contentElement);
  }

  private choose(options: () => MenuItem, event: Event): void {
    const chosen = untrack(options);
    if (chosen.disabled === true) return;
    chosen.onSelect?.(event);
    if (chosen.closeOnSelect !== false) this.root.close();
  }

  private leaveByTab(): void {
    const root = this.root;
    const trigger = root.layer.triggerElement;
    root.close();
    if (trigger?.isConnected && document.activeElement !== trigger) focusSafely(trigger);
  }

  private drag(): void {
    this.dragging = true;
    const stop = (): void => {
      this.dragging = false;
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  }

  private dismiss(reason: DismissReason): void {
    if (reason === 'focus' && this.conduct().dismissOnFocusOutside === false) return;
    this.close(reason);
  }

  private release(highlighted: HTMLElement | null): void {
    for (const sub of this.subs) if (sub.opened() && sub.subTriggerElement !== highlighted) sub.close();
  }

  private aimAt(sub: Menu, event: PointerEvent): void {
    const content = sub.contentElement;
    if (content === null) return;
    this.endAim();
    const toRight = content.getBoundingClientRect().left >= event.clientX;
    this.aim = { sub, over: event.relatedTarget, apex: { x: event.clientX + (toRight ? -APEX_PX : APEX_PX), y: event.clientY } };
    this.rest();
    document.addEventListener('pointermove', this.follow, true);
  }

  private readonly follow = (event: PointerEvent): void => {
    const aim = this.aim;
    if (aim === null) return;
    const point = { x: event.clientX, y: event.clientY };
    const box = aim.sub.contentElement?.getBoundingClientRect();
    if (box === undefined || within(box, point) || !onPath(point, aim.apex, box)) return this.endAim();
    aim.over = event.target;
    this.rest();
  };

  private rest(): void {
    clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => this.handOver(), REST_MS);
  }

  private handOver(): void {
    const row = this.collection.at(this.aim?.over ?? null);
    this.endAim();
    if (row === undefined) return;
    this.collection.point(row);
    for (const sub of this.subs) if (sub.subTriggerElement === row) sub.reach();
  }

  private endAim(): void {
    clearTimeout(this.restTimer);
    document.removeEventListener('pointermove', this.follow, true);
    this.aim = null;
  }
}
