import { QueryClient, notifyManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { single } from './builders/single.js';
import type { BaseQuery } from './types.js';

notifyManager.setScheduler((callback) => callback());

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

type Reading = { readonly promise: Promise<unknown>; readonly followed: () => unknown; readonly stop: () => void };

function readPromiseInDerived(query: BaseQuery<unknown>): Reading {
  let reading = $state(false);
  let read: Promise<unknown> | undefined;
  let followed: unknown;
  const stop = $effect.root(() => {
    $effect(() => void query.data);
    $effect(() => {
      followed = query.watch();
    });
    const awaited = $derived(reading ? query.promise : undefined);
    $effect(() => {
      read = awaited;
    });
  });
  flushSync();
  reading = true;
  flushSync();
  if (read === undefined) throw new Error('the derived never read the promise');
  return { promise: read, followed: () => followed, stop };
}

describe('reading a query promise inside a derived', () => {
  it('writes no state while another reader observes and follows the query', async () => {
    const query = single<string>({ name: 'Engine', queryClient: createQueryClient(), scope: Scope.make(), loader: async () => 'ready' });

    const reading = readPromiseInDerived(query);
    await expect(reading.promise).resolves.toBe('ready');
    reading.stop();
  });

  it('writes no state when the read itself starts the fetch, and its follower still hears it', async () => {
    const query = single<string>({
      name: 'Held',
      queryClient: createQueryClient(),
      scope: Scope.make(),
      enabled: false,
      loader: async () => 'ready',
    });

    const reading = readPromiseInDerived(query);
    await expect(reading.promise).resolves.toBe('ready');
    await Promise.resolve();
    flushSync();
    expect(reading.followed()).toBe('ready');
    reading.stop();
  });

  it('writes no state for a feed of pages observed and followed by other readers', async () => {
    const feed = single<{ page: number }>({
      name: 'Feed',
      queryClient: createQueryClient(),
      scope: Scope.make(),
      initialPageParam: 1,
      loader: async () => ({ page: 1 }),
    }).inf();

    const reading = readPromiseInDerived(feed as unknown as BaseQuery<unknown>);
    await expect(reading.promise).resolves.toEqual({ pages: [{ page: 1 }], pageParams: [1] });
    reading.stop();
  });
});
