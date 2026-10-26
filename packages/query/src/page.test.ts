import { QueryClient, notifyManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { describe, expect, it, vi } from 'vitest';

import { observe } from './test-utils/observe.svelte.js';
import { single } from './builders/single.js';
import type { SingleLoaderContext } from './types.js';

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

describe('page()', () => {
  it('load() returns data and refresh() refetches even within staleTime', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => {
      return { page: pageParam };
    });

    const query = single<{ page?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader,
    });

    const page = query.page({ page: 1 });
    const stop = observe(() => page.data);

    const v1 = await page.load();
    const v1b = await page.load();

    expect(v1).toEqual({ page: 1 });
    expect(v1b).toEqual({ page: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    const v2 = await page.refresh();
    expect(v2).toEqual({ page: 1 });
    expect(loader).toHaveBeenCalledTimes(2);

    const v3 = await page.load({ refresh: true });
    expect(v3).toEqual({ page: 1 });
    expect(loader).toHaveBeenCalledTimes(3);

    stop();
  });

  it('refresh() suppresses loader errors unless throwOnError is true', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });

    const query = single<{ page: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const page = query.page({ page: 1 });

    await expect(page.refresh()).resolves.toBeUndefined();
    await expect(page.refresh({ throwOnError: true })).rejects.toThrow('boom');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('loadOrThrow() throws the loader error by default', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });

    const query = single<{ page: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const page = query.page({ page: 1 });

    await expect(page.loadOrThrow()).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('promise starts loading and deduplicates the in-flight request', async () => {
    const queryClient = createQueryClient();
    const deferred = (() => {
      let resolve: (value: string) => void;
      const promise = new Promise<string>((res) => {
        resolve = res;
      });
      return { promise, resolve: resolve! };
    })();

    const loader = vi.fn(async () => {
      return await deferred.promise;
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    const page = query.page({ page: 1 });
    const stop = observe(() => page.data);

    const p1 = page.promise;
    const p2 = page.promise;

    expect(p1).toBe(p2);
    expect(loader).toHaveBeenCalledTimes(1);

    deferred.resolve('ok');
    await expect(p1).resolves.toBe('ok');

    stop();
  });
});
