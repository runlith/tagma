import type { Component } from 'svelte';

import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';

import { createOverlaySignals } from './overlay-signals.js';
import type { LauncherHandle, LauncherOpenOptions } from './types.js';

class LauncherEntry {
  id: string;
  key?: string;
  component: Component;
  props = $state<Record<string, unknown>>({});
  open = $state(true);
  closeResult: unknown = undefined;
  handle: LauncherHandle;

  readonly signals = createOverlaySignals<unknown>();

  constructor(options: {
    id: string;
    key?: string;
    component: Component;
    props: Record<string, unknown>;
    closeById: (id: string, result?: unknown) => void;
  }) {
    this.id = options.id;
    this.key = options.key;
    this.component = options.component;
    this.props = options.props;

    this.handle = {
      id: options.id,
      key: options.key,
      close: (result?: unknown) => options.closeById(options.id, result),
      update: (props: Record<string, unknown>) => {
        this.props = props;
      },
      presented: this.signals.presented,
      closed: this.signals.closed,
    };
  }
}

export class Launchers extends Service<Launchers>()('Launchers', { tier: 'app' }) {
  static make(): Launchers {
    return new Launchers();
  }

  elements = $state<LauncherEntry[]>([]);

  private seq = 0;
  private readonly byId = new SvelteMap<string, LauncherEntry>();

  open<TProps extends Record<string, unknown>>(
    component: Component<TProps>,
    props: TProps,
    options: LauncherOpenOptions = {},
  ): LauncherHandle {
    const id = this.createId();

    const entry = new LauncherEntry({
      id,
      key: options.key,
      component: component as Component,
      props,
      closeById: (entryId, result) => this.closeById(entryId, result),
    });

    this.byId.set(id, entry);
    this.elements = [...this.elements, entry];

    return entry.handle;
  }

  close(handle: LauncherHandle, result?: unknown): void {
    this.closeById(handle.id, result);
  }

  closeAll(): void {
    for (const entry of [...this.byId.values()]) this.closeById(entry.id);
  }

  markPresented(handle: LauncherHandle): void {
    this.byId.get(handle.id)?.signals.present();
  }

  private closeById(id: string, result?: unknown): void {
    const entry = this.byId.get(id);
    if (!entry) return;

    entry.closeResult = result;
    entry.open = false;
    this.byId.delete(id);
    this.elements = this.elements.filter((item) => item.id !== id);
    entry.signals.end(result);
  }

  private createId(): string {
    this.seq += 1;
    return `launcher:${Date.now()}:${this.seq}`;
  }
}
