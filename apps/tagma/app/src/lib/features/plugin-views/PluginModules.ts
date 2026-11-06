import { Service } from '@runlith/layer/key';
import type { Component } from 'svelte';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';

export type ViewComponent = Component<Record<string, unknown>>;

export class PluginModules extends Service<PluginModules>()('PluginModules', { tier: 'app' }) {
  static *make() {
    return new PluginModules(yield* ServerOrigin);
  }

  private readonly loads = new Map<string, Promise<ViewComponent>>();
  private readonly settled = new Map<string, ViewComponent>();

  constructor(private readonly origin: ServerOrigin) {
    super();
  }

  loaded(address: string): ViewComponent | undefined {
    return this.settled.get(address);
  }

  load(address: string): Promise<ViewComponent> {
    const standing = this.loads.get(address);
    if (standing !== undefined) return standing;
    const loading = import(new URL(address, this.origin.http).href).then((module: { readonly default?: unknown }) => {
      if (typeof module.default !== 'function') throw new Error(`${address} exports no Svelte component as its default`);
      const component = module.default as ViewComponent;
      this.settled.set(address, component);
      return component;
    });
    loading.catch(() => this.loads.delete(address));
    this.loads.set(address, loading);
    return loading;
  }

  preload(addresses: readonly string[]): void {
    for (const address of addresses) this.load(address).catch(() => undefined);
  }
}
