import { notifyManager, onlineManager } from '@tanstack/query-core';
import { App, MountedApp } from '@runlith/layer/App';
import { Layer } from '@runlith/layer/Layer';
import { Platform, serverPlatform } from '@runlith/layer/Platform';
import { Snapshot } from '@runlith/layer/Snapshot';
import { Visitor, makePlatform } from '@runlith/layer/testing';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { worldHooks } from '@runlith/layer/svelte/App.svelte';
import { flush } from '@runlith/testing/flush';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Cache, Repo } from './repo.js';

notifyManager.setScheduler((callback) => callback());

afterEach(() => {
  onlineManager.setOnline(true);
});

function mount(options: { platform?: Platform; gcTime?: number } = {}) {
  return mountApp(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false, gcTime: options.gcTime } } })),
    Layer.of(Platform, options.platform ?? makePlatform()),
    { ladder: [Visitor], at: { visitor: Visitor.guest() } },
  );
}

describe('Cache.of', () => {
  it('holds the client mounted for the life of the scope, so paused work resumes on reconnect', async () => {
    const app = mount();
    const client = app.get(Cache);
    onlineManager.setOnline(false);

    const loader = vi.fn(async () => 'resumed');
    const pending = client.fetchQuery({ queryKey: ['lease'], queryFn: loader });
    await vi.waitFor(() => expect(client.getQueryState(['lease'])?.fetchStatus).toBe('paused'));

    onlineManager.setOnline(true);
    await expect(pending).resolves.toBe('resumed');
    expect(loader).toHaveBeenCalledTimes(1);

    await app.unmount();
  });

  it('is what the snapshot carries: a cache filled in one graph fills the next without a request', async () => {
    const source = mount();
    const filled = source.get(Cache);
    await filled.fetchQuery({ queryKey: ['carried'], queryFn: async () => 'from-source' });
    const record = source.get(Snapshot).take();
    await source.unmount();

    const target = mount();
    target.get(Snapshot).apply(record);
    expect(target.get(Cache).getQueryData(['carried'])).toBe('from-source');

    await target.unmount();
  });

  it('what a server graph cached reaches the tab through its snapshot, without a request', async () => {
    const server = mount({ platform: serverPlatform() });
    await server.get(Cache).fetchQuery({ queryKey: ['rendered'], queryFn: async () => 'from-server' });
    const record = server.get(Snapshot).take();
    await server.unmount();

    const tab = mount();
    tab.get(Snapshot).apply(record);
    expect(tab.get(Cache).getQueryData(['rendered'])).toBe('from-server');

    await tab.unmount();
  });

  it('a snapshot applied before the app started reaches the cache once it starts, in the order the tab load runs', async () => {
    const source = mount();
    await source.get(Cache).fetchQuery({ queryKey: ['visitor:guest/early.value'], queryFn: async () => 'from-server' });
    const record = source.get(Snapshot).take();
    await source.unmount();

    const definition = App.define(
      Layer.mergeAll(
        Cache.of({ defaultOptions: { queries: { retry: false } } }),
        Layer.of(Platform, makePlatform()),
        Visitor.of(() => Visitor.guest()),
      ),
      { ladder: [Visitor] },
    );
    const app = new MountedApp(definition, Layer.mergeAll(), worldHooks);
    app.snapshot.apply(record);
    app.start();
    await app.ready;
    expect(app.resolve(Cache).getQueryData(['visitor:guest/early.value'])).toBe('from-server');
    await app.close();
  });

  it('invalidates every answer a scope owns, or those of the repositories named, and leaves the other scopes alone', async () => {
    const app = mount();
    const client = app.get(Cache);
    const Blocks = Repo.define('blocks', ($) => ({ tree: $.single(async () => async () => 'tree') }), { tier: 'visitor', door: Cache });
    const Journal = Repo.define('journal', ($) => ({ head: $.single(async () => async () => 'head') }), { tier: 'visitor', door: Cache });
    const guest = app.app.scopeOf('visitor');
    const other = app.app.hold('visitor', Visitor.user('1'));
    for (const name of ['visitor:guest/blocks.tree', 'visitor:guest/journal.head', 'visitor:user:1/blocks.tree', 'shop/public.value']) {
      client.setQueryData([name], 'fresh');
    }
    const stale = () =>
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.isInvalidated)
        .map((query) => query.queryKey[0])
        .sort();

    await Cache.invalidate(client, guest, [Blocks]);
    expect(stale()).toEqual(['visitor:guest/blocks.tree']);

    await Cache.invalidate(client, guest);
    expect(stale()).toEqual(['visitor:guest/blocks.tree', 'visitor:guest/journal.head']);
    expect(Cache.owns(app.app.app, ['shop/public.value'])).toBe(true);
    expect(Cache.owns(guest, ['visitor:user:1/blocks.tree'], [Journal])).toBe(false);
    expect(Repo.prefixOf(other.scope)).toBe('visitor:user:1/');
    expect(Repo.prefixOf(app.app.app)).toBe('');

    other.release();
    await app.unmount();
  });

  it('a service invalidating through its own lifetime reaches the answers of the rung scope it lives in', async () => {
    const app = mount();
    const client = app.get(Cache);
    client.setQueryData(['visitor:guest/blocks.tree'], 'fresh');
    const life = app.app.scopeOf('visitor').child('GraphFeed');

    await Cache.invalidate(client, life);

    expect(client.getQueryState(['visitor:guest/blocks.tree'])?.isInvalidated).toBe(true);
    expect(Repo.prefixOf(life)).toBe('visitor:guest/');
    await app.unmount();
  });

  it('closing a rung scope sweeps its whole prefix, a hydrated entry of a repository never built included, and leaves the app tier alone', async () => {
    const app = mount();
    const client = app.get(Cache);
    client.setQueryData(['visitor:guest/never/built.value'], 'hydrated');
    client.setQueryData(['shop/public.value'], 'app-tier');

    app.place('visitor', Visitor.user('1'));
    await flush();
    expect(app.app.report().scopes.map((scope) => scope.name)).toEqual(['app', 'visitor:user:1']);
    expect(client.getQueryData(['visitor:guest/never/built.value'])).toBeUndefined();
    expect(client.getQueryData(['shop/public.value'])).toBe('app-tier');

    await app.unmount();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it('a server cache arms no gc timer, so a fetch still in flight when its scope closes holds nothing once it settles; the tab keeps its gcTime', async () => {
    const server = mount({ platform: serverPlatform(), gcTime: 180_000 });
    const tab = mount({ gcTime: 180_000 });
    vi.useFakeTimers();
    try {
      const inFlight = server.get(Cache).fetchQuery({ queryKey: ['hot'], gcTime: 3_600_000, queryFn: () => new Promise<string>(() => {}) });
      await server.unmount();
      await inFlight.catch(() => undefined);

      expect(vi.getTimerCount()).toBe(0);

      tab.get(Cache).setQueryData(['answer'], 'value');

      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
      await tab.unmount();
    }
  });
});
