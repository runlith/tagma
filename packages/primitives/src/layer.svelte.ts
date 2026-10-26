import { getContext, onDestroy, setContext } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import { overlayLayers, SURFACE_ATTRIBUTE, type OverlayLayers } from './OverlayLayers.svelte.js';

export type DismissReason = 'escape' | 'outside' | 'focus' | 'detached' | 'parent';

export type OpenedBy = 'pointer' | 'keyboard';

export type ReturnFocus = false | (() => HTMLElement | null);

export interface LayerConduct {
  readonly modal?: boolean;
  readonly dismissable?: boolean;
  readonly returnFocus?: () => ReturnFocus | undefined;
  readonly trapFocus?: () => boolean | undefined;
}

const CONTEXT = Symbol.for('@runlith/primitives/layer');

const OPENING_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);

export class OverlayLayer {
  z = $state(0);
  openedBy: OpenedBy | undefined = undefined;
  triggerElement: HTMLElement | null = null;
  anchorElement: HTMLElement | null = null;
  readonly elements = new Set<HTMLElement>();

  private opened = false;
  private cause: OpenedBy | undefined = undefined;
  private opener: HTMLElement | null = null;

  constructor(
    private readonly stack: OverlayLayers,
    readonly parent: OverlayLayer | undefined,
    private readonly onDismiss: (reason: DismissReason) => void,
    readonly conduct: LayerConduct = {},
  ) {}

  static make(onDismiss: (reason: DismissReason) => void, conduct: LayerConduct = {}): OverlayLayer {
    const layer = new OverlayLayer(overlayLayers, getContext<OverlayLayer | undefined>(CONTEXT), onDismiss, conduct);
    setContext(CONTEXT, layer);
    onDestroy(() => layer.end());
    return layer;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get modal(): boolean {
    return this.conduct.modal === true;
  }

  get dismissable(): boolean {
    return this.conduct.dismissable !== false;
  }

  get traps(): boolean {
    return this.conduct.trapFocus?.() ?? this.modal;
  }

  open(by?: OpenedBy): void {
    if (this.opened) return;
    if (this.modal && this.cause === undefined) this.stack.intend();
    this.opened = true;
    this.openedBy = by ?? this.cause;
    this.cause = undefined;
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.z = this.stack.enter(this);
  }

  close(reason?: DismissReason): void {
    if (!this.opened) return;
    const held = reason !== 'outside' && reason !== 'parent' && this.holdsFocus();
    for (const child of this.stack.descendants(this).toReversed()) child.dismiss('parent');
    this.opened = false;
    this.stack.leave(this);
    if (held) this.giveBackFocus();
    if (this.elements.size === 0) this.stack.vacate(this);
  }

  dismiss(reason: DismissReason): void {
    this.onDismiss(reason);
  }

  end(): void {
    this.close();
    this.stack.vacate(this);
  }

  owns(node: Node): boolean {
    if (this.triggerElement?.contains(node)) return true;
    for (const element of this.elements) if (element.contains(node)) return true;
    return false;
  }

  descendantElements(): readonly HTMLElement[] {
    return this.stack.descendants(this).flatMap((child) => [...child.elements]);
  }

  prime(cause: OpenedBy): void {
    if (this.opened) return;
    this.cause = cause;
    this.stack.intend();
  }

  readonly surface: Attachment<HTMLElement> = (element) => {
    this.elements.add(element);
    element.setAttribute(SURFACE_ATTRIBUTE, '');
    const unwatch = this.stack.watch(element);
    return () => {
      this.elements.delete(element);
      unwatch();
      if (!this.opened && this.elements.size === 0) this.stack.vacate(this);
    };
  };

  readonly trigger: Attachment<HTMLElement> = (element) => {
    this.triggerElement = element;
    const press = (): void => this.prime('pointer');
    const key = (event: KeyboardEvent): void => {
      if (OPENING_KEYS.has(event.key)) this.prime('keyboard');
    };
    element.addEventListener('pointerdown', press);
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('keydown', key);
      if (this.triggerElement === element) this.triggerElement = null;
    };
  };

  private holdsFocus(): boolean {
    const active = document.activeElement;
    if (active === null || active === document.body) return true;
    const within = (element: HTMLElement): boolean => element.contains(active);
    return [...this.elements].some(within) || this.descendantElements().some(within);
  }

  private giveBackFocus(): void {
    const chosen = this.conduct.returnFocus?.();
    if (chosen === false) return;
    const target = chosen === undefined ? (this.triggerElement ?? this.anchorElement ?? this.opener) : chosen();
    if (target?.isConnected) this.stack.restore(target);
  }
}
