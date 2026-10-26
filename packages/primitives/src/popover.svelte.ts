import { getContext, setContext, untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import { Float, type Anchor } from './float.svelte.js';
import { focusInitialIn, focusSafely } from './focus.js';
import { OverlayLayer, type DismissReason, type ReturnFocus } from './layer.svelte.js';
import { overlayLayers } from './OverlayLayers.svelte.js';
import type { PlaceOptions } from './place.js';

export type InitialFocus = false | (() => HTMLElement | null);

export interface PopoverConduct extends PlaceOptions {
  readonly anchor?: Anchor;
  readonly initialFocus?: InitialFocus;
  readonly returnFocus?: ReturnFocus;
  readonly dismissOnFocusOutside?: boolean;
  readonly trapFocus?: boolean;
}

export interface HoverIntent {
  readonly openMs: number;
  readonly closeMs: number;
}

type Opening = 'hover' | 'press';

const CONTEXT = Symbol.for('@runlith/primitives/popover');

export class Popover {
  conduct: () => PopoverConduct = () => ({});

  private openings = $state(0);
  private by: Opening = 'press';
  private intent: HoverIntent | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private surface: HTMLElement | null = null;

  constructor(
    readonly id: string,
    readonly layer: OverlayLayer,
    readonly float: Float,
    private readonly opened: () => boolean,
    private readonly change: (open: boolean) => void,
  ) {
    $effect.pre(() => {
      const open = this.opened();
      untrack(() => {
        if (!open) {
          this.by = 'press';
          return this.layer.close();
        }
        this.layer.open();
        this.openings += 1;
      });
    });
  }

  static make(id: string, open: () => boolean, change: (open: boolean) => void): Popover {
    const layer = OverlayLayer.make((reason) => popover.dismiss(reason), {
      returnFocus: () => popover.conduct().returnFocus,
      trapFocus: () => popover.conduct().trapFocus !== false,
    });
    const float = Float.make(
      layer,
      () => popover.anchor,
      () => popover.conduct(),
    );
    const popover = new Popover(id, layer, float, open, change);
    setContext(CONTEXT, popover);
    return popover;
  }

  static use(): Popover {
    const popover = getContext<Popover | undefined>(CONTEXT);
    if (popover === undefined) throw new Error('A popover part stands outside a popover root');
    return popover;
  }

  get open(): boolean {
    return this.opened();
  }

  get anchor(): Anchor | undefined {
    return this.conduct().anchor ?? this.layer.triggerElement ?? undefined;
  }

  readonly trigger: Attachment<HTMLElement> = (element) => {
    const leave = this.layer.trigger(element);
    const toggle = (event: MouseEvent): void => {
      this.settle();
      if (this.opened() && this.by === 'hover') return this.latch(event.detail === 0);
      this.by = 'press';
      this.change(!this.opened());
    };
    element.addEventListener('click', toggle);
    return () => {
      element.removeEventListener('click', toggle);
      if (typeof leave === 'function') leave();
    };
  };

  hover(intent: HoverIntent): Attachment<HTMLElement> {
    return (element) => {
      this.intent = intent;
      const enter = (event: PointerEvent): void => {
        if (event.pointerType === 'touch') return;
        this.settle();
        if (this.opened() || event.buttons !== 0 || overlayLayers.top() !== undefined) return;
        this.timer = setTimeout(() => {
          this.timer = undefined;
          if (this.opened() || overlayLayers.top() !== undefined) return;
          this.by = 'hover';
          this.change(true);
        }, intent.openMs);
      };
      const leave = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') this.linger();
      };
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointerleave', leave);
      return () => {
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
        this.settle();
        if (this.intent === intent) this.intent = null;
      };
    };
  }

  hold(): void {
    this.settle();
    this.by = 'press';
    this.openings += 1;
  }

  readonly content: Attachment<HTMLElement> = (element) => {
    let given = 0;
    $effect(() => {
      const opening = this.openings;
      if (opening === given || !this.opened() || this.float.placement === undefined) return;
      given = opening;
      untrack(() => {
        if (this.by === 'press') this.give(element);
      });
    });
    const stay = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') this.settle();
    };
    const linger = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') this.linger();
    };
    this.surface = element;
    element.addEventListener('pointerenter', stay);
    element.addEventListener('pointerleave', linger);
    const leave = this.layer.surface(element);
    const unfloat = this.float.floating(element);
    return () => {
      element.removeEventListener('pointerenter', stay);
      element.removeEventListener('pointerleave', linger);
      if (this.surface === element) this.surface = null;
      if (typeof unfloat === 'function') unfloat();
      if (typeof leave === 'function') leave();
    };
  };

  private linger(): void {
    this.settle();
    const intent = this.intent;
    if (intent === null || !this.opened() || this.by !== 'hover') return;
    this.timer = setTimeout(() => this.fade(), intent.closeMs);
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private latch(byKeyboard: boolean): void {
    this.by = 'press';
    if (byKeyboard && this.surface !== null) this.give(this.surface);
  }

  private fade(): void {
    const inside = this.surface?.contains(document.activeElement) === true;
    this.layer.close(inside ? undefined : 'outside');
    this.change(false);
  }

  private give(element: HTMLElement): void {
    const chosen = this.conduct().initialFocus;
    if (chosen === false) return;
    if (chosen !== undefined) {
      const target = chosen();
      if (target !== null) focusSafely(target);
    } else if (!focusInitialIn(element)) focusSafely(element);
  }

  private dismiss(reason: DismissReason): void {
    if (reason === 'focus' && this.conduct().dismissOnFocusOutside === false) return;
    this.settle();
    this.layer.close(reason);
    this.change(false);
  }
}
