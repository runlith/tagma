import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import type { Anchor } from './float.svelte.js';
import { overlayLayers, type OverlayLayers } from './OverlayLayers.svelte.js';
import type { Side } from './place.js';

export interface TooltipHint {
  readonly keys: string;
  readonly words: string;
}

export interface TooltipOptions {
  readonly text: string | null | undefined;
  readonly keys?: string | null;
  readonly hints?: readonly TooltipHint[];
  readonly side?: Side;
  readonly delayMs?: number;
  readonly anchor?: Anchor;
}

interface Target {
  readonly element: HTMLElement;
  readonly options: () => TooltipOptions;
}

export class Tooltip {
  private shown = $state.raw<Target | undefined>(undefined);
  private visible: Target | undefined;
  private pending: Target | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unlisten: (() => void) | undefined;

  constructor(private readonly stack: OverlayLayers) {}

  get text(): string | undefined {
    return this.shown?.options().text || undefined;
  }

  get keys(): string | undefined {
    return this.shown?.options().keys || undefined;
  }

  get hints(): readonly TooltipHint[] {
    return this.shown?.options().hints ?? [];
  }

  get side(): Side {
    return this.shown?.options().side ?? 'top';
  }

  get anchor(): Anchor | undefined {
    const shown = this.shown;
    return shown === undefined ? undefined : (shown.options().anchor ?? shown.element);
  }

  hide(): void {
    this.cancel();
    this.visible = undefined;
    untrack(() => (this.shown = undefined));
    this.unlisten?.();
    this.unlisten = undefined;
  }

  readonly trigger =
    (options: () => TooltipOptions): Attachment<HTMLElement> =>
    (element) => {
      const target: Target = { element, options };
      let inside = false;
      let pressed = false;
      const over = (event: PointerEvent): void => {
        if (inside || event.pointerType === 'touch') return;
        inside = true;
        if (options().text) this.schedule(target);
      };
      const out = (event: PointerEvent): void => {
        if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
        inside = false;
        if (event.pointerType !== 'touch') pressed = false;
        this.drop(target);
      };
      const focus = (event: FocusEvent): void => {
        if (pressed) pressed = false;
        else if (event.target instanceof Element && event.target.matches(':focus-visible')) this.show(target);
      };
      const blur = (event: FocusEvent): void => {
        if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
        this.drop(target);
      };
      const press = (): void => {
        pressed = true;
        this.drop(target);
      };
      let worded = false;
      $effect(() => {
        const was = worded;
        worded = Boolean(options().text);
        if (!worded) untrack(() => this.drop(target));
        else if (!was && inside) untrack(() => this.schedule(target));
      });
      element.addEventListener('pointerover', over);
      element.addEventListener('pointerout', out);
      element.addEventListener('pointerdown', press);
      element.addEventListener('focusin', focus);
      element.addEventListener('focusout', blur);
      return () => {
        element.removeEventListener('pointerover', over);
        element.removeEventListener('pointerout', out);
        element.removeEventListener('pointerdown', press);
        element.removeEventListener('focusin', focus);
        element.removeEventListener('focusout', blur);
        this.drop(target);
      };
    };

  private schedule(target: Target): void {
    if (this.visible === target) return;
    this.cancel();
    this.pending = target;
    this.timer = setTimeout(() => this.show(target), target.options().delayMs ?? 400);
  }

  private show(target: Target): void {
    this.cancel();
    if (this.visible === target) return;
    if (!target.element.isConnected || !target.options().text || this.covered(target.element)) return;
    this.visible = target;
    untrack(() => (this.shown = target));
    this.unlisten ??= this.listen();
  }

  private drop(target: Target): void {
    if (this.pending === target) this.cancel();
    if (this.visible === target) this.hide();
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  private covered(element: HTMLElement): boolean {
    return this.stack
      .layers()
      .some(({ triggerElement: trigger }) => trigger !== null && (element.contains(trigger) || trigger.contains(element)));
  }

  private listen(): () => void {
    const hide = (): void => this.hide();
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') this.hide();
    };
    const scroll = (event: Event): void => {
      const shown = this.visible;
      if (shown !== undefined && event.target instanceof Node && event.target.contains(shown.element)) this.hide();
    };
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', hide);
    };
  }
}

export const tooltip = new Tooltip(overlayLayers);
