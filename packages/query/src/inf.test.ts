import { QueryClient, notifyManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { waitFor } from '@runlith/testing/flush';
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
        retryDelay: 0,
        gcTime: 0,
      },
    },
  });
}

describe('inf()', () => {
  it('watch() does not trigger loading', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => ({ id: 1 }));

    const query = single<{ id: number }>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      initialPageParam: 1,
      loader: async ({ signal }) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const inf = query.inf();
    expect(inf.watch()).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it('refresh() reloads every page with the same pagination callbacks', async () => {
    const queryClient = createQueryClient();
    const revisions = new Map<number, number>();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => {
      const page = pageParam ?? 1;
      const revision = (revisions.get(page) ?? 0) + 1;
      revisions.set(page, revision);
      return { page, revision };
    });

    const query = single<{ page: number; revision: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader,
      initialPageParam: 2,
      getNextPageParam: (lastPage) => (lastPage.page < 3 ? lastPage.page + 1 : undefined),
      getPreviousPageParam: (firstPage) => (firstPage.page > 1 ? firstPage.page - 1 : undefined),
    });

    const inf = query.inf();
    const stop = observe(() => inf.data);

    try {
      await expect(inf.loadOrThrow()).resolves.toMatchObject({ pages: [{ page: 2, revision: 1 }] });
      await inf.fetchPreviousPage();
      await inf.fetchNextPage();

      expect(inf.watch()).toEqual({
        pages: [
          { page: 1, revision: 1 },
          { page: 2, revision: 1 },
          { page: 3, revision: 1 },
        ],
        pageParams: [1, 2, 3],
      });

      await expect(inf.refresh({ throwOnError: true })).resolves.toEqual({
        pages: [
          { page: 1, revision: 2 },
          { page: 2, revision: 2 },
          { page: 3, revision: 2 },
        ],
        pageParams: [1, 2, 3],
      });

      expect(inf.watch()?.pages).toEqual([
        { page: 1, revision: 2 },
        { page: 2, revision: 2 },
        { page: 3, revision: 2 },
      ]);
    } finally {
      stop();
    }
  });

  it('requires initialPageParam without inventing a numeric cursor', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => ({ cursor: 'unused' }));

    const query = single<{ cursor: string }, Error, string>({
      name: 'RequiredCursor',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    expect(() => query.inf()).toThrow(/initialPageParam/i);
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it('different string initialPageParam values create independent infinite queries', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<string>) => ({ cursor: pageParam }));

    const query = single<{ cursor?: string }, Error, string>({
      name: 'StringCursor',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const first = query.inf({ initialPageParam: 'first', pageSize: 20 });
    const second = query.inf({ initialPageParam: 'second', pageSize: 20 });

    expect(first).not.toBe(second);
    await expect(first.loadOrThrow()).resolves.toEqual({
      pages: [{ cursor: 'first' }],
      pageParams: ['first'],
    });
    await expect(second.loadOrThrow()).resolves.toEqual({
      pages: [{ cursor: 'second' }],
      pageParams: ['second'],
    });
  });

  it('promise starts loading and deduplicates the in-flight request', async () => {
    const queryClient = createQueryClient();
    const deferred = (() => {
      let resolve: (value: { page: number }) => void;
      const promise = new Promise<{ page: number }>((res) => {
        resolve = res;
      });
      return { promise, resolve: resolve! };
    })();

    const loader = vi.fn(async () => {
      return await deferred.promise;
    });

    const query = single<{ page: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
      initialPageParam: 1,
    });

    const inf = query.inf();
    const stop = observe(() => inf.data);

    const p1 = inf.promise;
    const p2 = inf.promise;

    expect(p1).toBe(p2);
    expect(loader).toHaveBeenCalledTimes(1);

    deferred.resolve({ page: 1 });
    await expect(p1).resolves.toMatchObject({ pages: [{ page: 1 }] });

    stop();
  });

  it('uses QueryClient default retry options when retry is omitted', async () => {
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
      initialPageParam: 1,
    });

    const inf = query.inf();
    await expect(inf.load({ throwOnError: true })).rejects.toThrow('boom');

    expect(loader).toHaveBeenCalledTimes(1);
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
      initialPageParam: 1,
    });

    const inf = query.inf();
    await expect(inf.loadOrThrow()).rejects.toThrow('boom');

    expect(loader).toHaveBeenCalledTimes(1);
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
      initialPageParam: 1,
    });

    const inf = query.inf();

    await expect(inf.refresh()).resolves.toBeUndefined();
    await expect(inf.refresh({ throwOnError: true })).rejects.toThrow('boom');

    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('inf: live', () => {
  it('fetches its first page with no reader', async () => {
    const scope = Scope.make();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => ({ page: pageParam ?? 0 }));
    const feed = single<{ page: number }, Error, number>({
      name: 'LiveFeed',
      queryClient: createQueryClient(),
      scope,
      loader,
      initialPageParam: 1,
      getNextPageParam: () => undefined,
      live: true,
    }).inf();

    await waitFor(() => expect(feed.watch()?.pages).toEqual([{ page: 1 }]));
    await scope.close();
  });
});
