import type { Component } from 'svelte';

import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';

import { createOverlaySignals } from './overlay-signals.js';
import { overlayLayers } from './OverlayLayers.svelte.js';

import type { DialogHandle, DialogOpenOptions, DialogMotion, EscapeKeydownBehavior, InteractOutsideBehavior } from './types.js';

export class DialogEntry {
  id: string;
  key?: string;
  interactOutsideBehavior = $state<InteractOutsideBehavior | (() => InteractOutsideBehavior)>('close');
  escapeKeydownBehavior = $state<EscapeKeydownBehavior | (() => EscapeKeydownBehavior)>('close');
  onEscapeIgnored = $state<(() => void) | undefined>(undefined);
  motion?: DialogMotion;
  overlayClass = $state<string | undefined>(undefined);
  scrim = $state(true);
  component: Component;
  props = $state<Record<string, unknown>>({});
  open = $state(true);
  closeResult: unknown = undefined;
  reachable = true;
  handle: DialogHandle;

  readonly signals = createOverlaySignals<unknown>();

  get resolvedInteractOutsideBehavior(): InteractOutsideBehavior {
    const value = this.interactOutsideBehavior;
    return typeof value === 'function' ? value() : value;
  }

  get resolvedEscapeKeydownBehavior(): EscapeKeydownBehavior {
    const value = this.escapeKeydownBehavior;
    return typeof value === 'function' ? value() : value;
  }

  constructor(options: {
    id: string;
    key?: string;
    interactOutsideBehavior: InteractOutsideBehavior | (() => InteractOutsideBehavior);
    escapeKeydownBehavior: EscapeKeydownBehavior | (() => EscapeKeydownBehavior);
    motion?: DialogMotion;
    overlayClass?: string;
    scrim?: boolean;
    component: Component;
    props: Record<string, unknown>;
    closeById: (id: string, result?: unknown) => void;
  }) {
    this.id = options.id;
    this.key = options.key;
    this.interactOutsideBehavior = options.interactOutsideBehavior;
    this.escapeKeydownBehavior = options.escapeKeydownBehavior;
    this.motion = options.motion;
    this.overlayClass = options.overlayClass;
    this.scrim = options.scrim ?? true;
    this.component = options.component;
    this.props = options.props;
    this.handle = {
      id: options.id,
      key: options.key,
      close: (result?: unknown) => options.closeById(options.id, result),
      update: (props: Record<string, unknown>) => {
        this.props = props;
      },
      reopen: () => {
        if (!this.reachable) return false;
        this.closeResult = undefined;
        this.open = true;
        return true;
      },
      apply: (options: Omit<DialogOpenOptions, 'key'>) => {
        this.interactOutsideBehavior = options.interactOutsideBehavior ?? 'close';
        this.escapeKeydownBehavior = options.escapeKeydownBehavior ?? 'close';
        this.onEscapeIgnored = options.onEscapeIgnored;
        this.motion = options.motion;
        this.overlayClass = options.overlayClass;
        this.scrim = options.scrim ?? true;
      },
      presented: this.signals.presented,
      closed: this.signals.closed,
    };
  }
}

export class Dialogs extends Service<Dialogs>()('Dialogs', { tier: 'app' }) {
  static make(): Dialogs {
    return new Dialogs();
  }

  stack = $state<DialogEntry[]>([]);

  private seq = 0;
  private readonly byId = new SvelteMap<string, DialogEntry>();
  private readonly openRoots = new SvelteMap<symbol, string | undefined>();

  get anyOpen(): boolean {
    return this.openRoots.size > 0;
  }

  anyOpenExcept(keys: ReadonlySet<string>): boolean {
    for (const key of this.openRoots.values()) {
      if (key === undefined || !keys.has(key)) return true;
    }
    return false;
  }

  trackRoot(id: symbol, open: boolean, key?: string): void {
    if (open) this.openRoots.set(id, key);
    else this.openRoots.delete(id);
  }

  untrackRoot(id: symbol): void {
    this.openRoots.delete(id);
  }

  open<TProps extends Record<string, unknown>>(component: Component<TProps>, props: TProps, options?: DialogOpenOptions): DialogHandle {
    const key = options?.key;
    const interactOutsideBehavior = options?.interactOutsideBehavior ?? 'close';
    const escapeKeydownBehavior = options?.escapeKeydownBehavior ?? 'close';
    const motion = options?.motion;
    if (options?.announced !== true) overlayLayers.intend();

    const id = this.createId();

    const entry = new DialogEntry({
      id,
      key,
      interactOutsideBehavior,
      escapeKeydownBehavior,
      motion,
      overlayClass: options?.overlayClass,
      scrim: options?.scrim,
      component: component as Component,
      props,
      closeById: (entryId, result) => this.closeById(entryId, result),
    });

    this.byId.set(id, entry);

    this.stack = [...this.stack, entry];

    return entry.handle;
  }

  close(handle: DialogHandle, result?: unknown): void {
    this.closeById(handle.id, result);
  }

  closeAll(): void {
    for (const entry of [...this.stack]) {
      this.closeById(entry.id);
    }
  }

  markPresented(handle: DialogHandle): void {
    const entry = this.byId.get(handle.id);
    if (!entry) return;
    entry.signals.present();
  }

  finalizeClose(handle: DialogHandle): void {
    const entry = this.byId.get(handle.id);
    if (!entry) return;

    entry.reachable = false;
    this.byId.delete(entry.id);
    this.stack = this.stack.filter((item) => item.id !== entry.id);
    entry.signals.end(entry.closeResult);
  }

  syncOpenState(handle: DialogHandle, open: boolean): void {
    const entry = this.byId.get(handle.id);
    if (!entry) return;
    entry.open = open;
  }

  private closeById(id: string, result?: unknown): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    entry.closeResult = result;
    entry.open = false;

    if (!entry.signals.wasPresented()) this.finalizeClose(entry.handle);
  }

  private createId(): string {
    this.seq += 1;
    return `dialog:${Date.now()}:${this.seq}`;
  }
}
