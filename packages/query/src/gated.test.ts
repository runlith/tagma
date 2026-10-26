import { QueryClient, focusManager, notifyManager, onlineManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushSync, mount, unmount } from 'svelte';

import GatedProbe from './test-utils/GatedProbe.svelte';
import { createSignal } from './test-utils/signal.svelte.js';
import { observersCount } from './test-utils/observe.svelte.js';
import { gated } from './gated.svelte.js';
import { keyed } from './builders/keyed.js';
import { single } from './builders/single.js';

notifyManager.setScheduler((callback) => callback());

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function mountProbe(gate: { data: unknown; isDisabled: boolean; isLoading: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(GatedProbe, { target, props: { gate } });
  return {
    app,
    target,
    destroy() {
      unmount(app);
      target.remove();
    },
  };
}

beforeEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

afterEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

describe('gated', () => {
  it('a closed gate has no fetch or subscription and returns safe defaults', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const enabled = createSignal(false);
    const gate = gated(() => (enabled.get() ? query : undefined));

    const probe = mountProbe(gate);
    flushSync();

    expect(gate.isDisabled).toBe(true);
    expect(gate.data).toBeUndefined();
    expect(gate.isLoading).toBe(false);
    expect(gate.query).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(0);
    expect(observersCount(queryClient, ['Test'])).toBe(0);
    expect(probe.target.textContent).toBe('undefined:true');

    probe.destroy();
  });

  it('opening the gate attaches and fetches; closing it detaches and returns defaults', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const enabled = createSignal(false);
    const gate = gated(() => (enabled.get() ? query : undefined));

    const probe = mountProbe(gate);
    flushSync();

    enabled.set(true);
    flushSync();

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(1);
    });

    await vi.waitFor(() => {
      expect(gate.data).toBe('ok');
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(gate.isDisabled).toBe(false);
    expect(gate.query).toBe(query);

    enabled.set(false);
    flushSync();

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(0);
    });

    expect(gate.isDisabled).toBe(true);
    expect(gate.data).toBeUndefined();
    expect(gate.query).toBeUndefined();

    probe.destroy();
  });

  it('imperative methods are no-ops when the gate is closed', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const gate = gated(() => ((false as boolean) ? query : undefined));

    await expect(gate.load()).resolves.toBeUndefined();
    await expect(gate.loadOrThrow()).resolves.toBeUndefined();
    await expect(gate.refresh()).resolves.toBeUndefined();
    expect(gate.watch()).toBeUndefined();
    await expect(gate.invalidate()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it('the infinite form exposes hasNextPage and fetchNextPage', async () => {
    const queryClient = createQueryClient();

    const query = single<string[], Error, number>({
      name: 'TestInf',
      queryClient,
      scope: Scope.make(),
      initialPageParam: 1,
      getNextPageParam: (_last, _all, lastParam) => (lastParam < 3 ? lastParam + 1 : undefined),
      loader: async ({ pageParam }) => [`p${pageParam ?? 1}`],
    });

    const inf = query.inf({ initialPageParam: 1 });
    const enabled = createSignal(true);
    const gate = gated(() => (enabled.get() ? inf : undefined));

    const probe = mountProbe(gate);
    flushSync();

    await vi.waitFor(() => {
      expect(gate.data?.pages).toEqual([['p1']]);
    });

    expect(gate.hasNextPage).toBe(true);
    expect(gate.query).toBe(inf);

    await gate.fetchNextPage();

    await vi.waitFor(() => {
      expect(gate.data?.pages).toEqual([['p1'], ['p2']]);
    });

    probe.destroy();
  });

  it('switching keys preserves the facade while data follows the key', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key }: { key: { id: number } }) => `v${key.id}`);

    const family = keyed<{ id: number }, string>({
      name: 'TestKeyed',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key }) => await loader({ key }),
    });

    const id = createSignal(1);
    const gate = gated(() => family.key({ id: id.get() }));

    const probe = mountProbe(gate);
    flushSync();

    await vi.waitFor(() => {
      expect(gate.data).toBe('v1');
    });

    const firstQuery = family.key({ id: 1 });

    id.set(2);
    flushSync();

    await vi.waitFor(() => {
      expect(gate.data).toBe('v2');
    });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(firstQuery).toBe(family.key({ id: 1 }));

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['TestKeyed', { id: 1 }])).toBe(0);
    });

    probe.destroy();
  });
});
