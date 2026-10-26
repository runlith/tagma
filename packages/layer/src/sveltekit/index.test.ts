import { flush } from '@runlith/testing/flush';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Layer } from '../Layer.js';
import { Router } from '../Router.js';
import { test as mountApp } from '../svelte/test.svelte.js';
import { Visitor } from '../testing.js';
import { RouterLive } from './index.js';

const kit = vi.hoisted(() => ({
  invalidated: [] as string[],
  navigation: null as Promise<void> | null,
  before: new Set<(navigation: unknown) => void>(),
  after: new Set<(navigation: unknown) => void>(),
}));

vi.mock('$app/navigation', async () => {
  const { onDestroy } = await import('svelte');
  const hook = (callbacks: Set<(navigation: unknown) => void>) => (callback: (navigation: unknown) => void) => {
    callbacks.add(callback);
    onDestroy(() => callbacks.delete(callback));
  };
  return {
    beforeNavigate: hook(kit.before),
    afterNavigate: hook(kit.after),
    goto: () => Promise.resolve(),
    invalidate: (dependency: string) => {
      kit.invalidated.push(dependency);
      return Promise.resolve();
    },
  };
});

vi.mock('$app/state', () => ({
  page: { url: new URL('https://app.test/'), route: { id: '/' }, params: {}, status: 200, data: {} },
  navigating: {
    get complete() {
      return kit.navigation;
    },
  },
}));

afterEach(() => {
  kit.invalidated.length = 0;
  kit.navigation = null;
});

function mountOnGuest() {
  return mountApp(Layer.mergeAll(), RouterLive, { ladder: [Visitor], at: { visitor: Visitor.guest() } });
}

describe('RouterLive telling navigations', () => {
  it('tells each listener a SvelteKit navigation once before and once after, however many mounts publish the app, and nothing once it unsubscribed', async () => {
    const first = mountOnGuest();
    const second = mountOnGuest();
    await flush();
    const told: [string, unknown][] = [];
    const stop = first.get(Router).onNavigate({
      before: (navigation) => void told.push(['before', navigation]),
      after: (navigation) => void told.push(['after', navigation]),
    });
    const from = { url: new URL('https://app.test/'), route: { id: '/' }, params: {} };
    const to = { url: new URL('https://app.test/b/7'), route: { id: '/b/[id]' }, params: { id: '7' } };
    const navigation = { type: 'link', from, to, willUnload: false };
    for (const callback of kit.before) callback(navigation);
    for (const callback of kit.after) callback(navigation);

    const place = {
      type: 'link',
      from: { url: from.url, routeId: '/', params: {} },
      to: { url: to.url, routeId: '/b/[id]', params: { id: '7' } },
    };
    expect(told).toEqual([
      ['before', place],
      ['after', place],
    ]);

    stop();
    const later = { ...navigation, type: 'popstate' };
    for (const callback of kit.before) callback(later);
    expect(told).toHaveLength(2);
    await first.unmount();
    await second.unmount();
  });
});

describe('RouterLive re-resolving the loads of a rung that moved', () => {
  it('waits for the navigation SvelteKit is performing: an invalidation would abort it and leave `navigating` set', async () => {
    const rt = mountOnGuest();
    await flush();
    let land!: () => void;
    kit.navigation = new Promise<void>((resolve) => (land = resolve));

    rt.place('visitor', Visitor.user('7'));
    await flush();
    expect(kit.invalidated).toEqual([]);

    kit.navigation = null;
    land();
    await flush();
    expect(kit.invalidated).toEqual([Visitor.dependency]);
    await rt.unmount();
  });

  it('is not held by a navigation somebody else already aborted', async () => {
    const rt = mountOnGuest();
    await flush();
    kit.navigation = Promise.reject(new Error('navigation aborted'));
    kit.navigation.catch(() => undefined);

    rt.place('visitor', Visitor.user('7'));
    await flush();
    expect(kit.invalidated).toEqual([Visitor.dependency]);
    await rt.unmount();
  });
});
