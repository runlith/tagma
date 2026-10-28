import { QueryClient, focusManager, notifyManager, onlineManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { flush, waitFor } from '@runlith/testing/flush';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoAttachProbe from './test-utils/AutoAttachProbe.svelte';
import LoadingSwitchProbe from './test-utils/LoadingSwitchProbe.svelte';
import { createSignal } from './test-utils/signal.svelte.js';
import { observe, observersCount } from './test-utils/observe.svelte.js';
import { flushSync, mount, unmount } from 'svelte';
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

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

beforeEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

describe('single', () => {
  it('watch() does not trigger loading', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    expect(query.watch()).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(0);
  });

  describe('watch(): follows the cache without owning it', () => {
    function makeQuery(queryClient: QueryClient, loader: () => Promise<string>) {
      return single<string>({
        name: 'Test',
        queryClient,
        scope: Scope.make(),
        loader: async () => await loader(),
        staleTime: 60_000,
      });
    }

    it('derived watch() recomputes on arrival and removal without an observer', async () => {
      const queryClient = createQueryClient();
      const query = makeQuery(queryClient, async () => 'ok');

      let seen: string | undefined = 'unset';
      const stop = observe(() => {
        seen = query.watch();
      });
      expect(seen).toBeUndefined();

      await query.load();
      flushSync();
      expect(seen).toBe('ok');
      expect(observersCount(queryClient, ['Test'])).toBe(0);

      query.reset();
      flushSync();
      expect(seen).toBeUndefined();

      stop();
    });

    it('watchFetching() sees a retry after an error and its end, without an observer', async () => {
      const queryClient = createQueryClient();
      const reply = deferred<string>();
      let calls = 0;
      const query = makeQuery(queryClient, async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return await reply.promise;
      });

      let fetching: boolean | undefined;
      const stop = observe(() => {
        fetching = query.watchFetching();
      });
      await query.load();
      flushSync();
      expect(query.watchError()).toBeInstanceOf(Error);
      expect(fetching).toBe(false);

      const asked = query.refresh();
      flushSync();
      expect(fetching).toBe(true);

      reply.resolve('ok');
      await asked;
      flushSync();
      expect(fetching).toBe(false);
      expect(observersCount(queryClient, ['Test'])).toBe(0);

      stop();
    });

    it('watch() outside a reactive context reads the cache without retaining a listener', async () => {
      const queryClient = createQueryClient();
      const query = makeQuery(queryClient, async () => 'ok');
      const listeners = (queryClient.getQueryCache() as unknown as { listeners: Set<unknown> }).listeners;
      const before = listeners.size;

      expect(query.watch()).toBeUndefined();
      await query.load();
      expect(query.watch()).toBe('ok');
      expect(listeners.size).toBe(before);
      expect(observersCount(queryClient, ['Test'])).toBe(0);
    });

    it('the cache listener leaves with its reader', async () => {
      const queryClient = createQueryClient();
      const query = makeQuery(queryClient, async () => 'ok');
      const listeners = (queryClient.getQueryCache() as unknown as { listeners: Set<unknown> }).listeners;
      const before = listeners.size;

      const stop = observe(() => void query.watch());
      expect(listeners.size).toBe(before + 1);

      stop();
      await Promise.resolve();
      expect(listeners.size).toBe(before);
    });
  });

  it('reset() clears the cache without destroying the query', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    await query.load();
    expect(query.watch()).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(1);

    query.reset();

    expect(query.watch()).toBeUndefined();

    await query.load();
    expect(query.watch()).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('an unreactive read returns the cache without subscribing', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');
    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    expect(query.data).toBeUndefined();
    expect(observersCount(queryClient, ['Test'])).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });

  it('a reactive reader outside a component subscribes, loads and releases observation', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    await waitFor(() => {
      expect(query.watch()).toBe('ok');
    });

    expect(observersCount(queryClient, ['Test'])).toBe(1);

    stop();
    await waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(0);
    });
  });

  it('auto-attach inside a component starts loading and detaches on unmount', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(AutoAttachProbe, {
      target,
      props: {
        query,
      },
    });

    await waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(1);
    });

    await waitFor(() => {
      expect(query.watch()).toBe('ok');
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(observersCount(queryClient, ['Test'])).toBe(1);

    unmount(app);
    target.remove();

    await waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(0);
    });
  });

  it('auto-attach with staleTime=0 refetches on remount even with cached data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 1_000,
        },
      },
    });

    let counter = 0;
    const loader = vi.fn(async () => {
      counter += 1;
      return `ok-${counter}`;
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 0,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const mountProbe = () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const app = mount(AutoAttachProbe, {
        target,
        props: {
          query,
        },
      });

      return { app, target };
    };

    const first = mountProbe();

    await waitFor(() => {
      expect(query.watch()).toBe('ok-1');
    });
    expect(loader).toHaveBeenCalledTimes(1);

    unmount(first.app);
    first.target.remove();

    await waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(0);
    });

    const second = mountProbe();

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(query.watch()).toBe('ok-2');
    });

    unmount(second.app);
    second.target.remove();
  });

  it('auto-attach unmount preserves an in-flight fetch to warm the cache (forkPreload)', async () => {
    const queryClient = createQueryClient();
    const deferredLoad = deferred<string>();
    const signals: AbortSignal[] = [];

    const loader = vi.fn(async ({ signal }: SingleLoaderContext) => {
      signals.push(signal);
      signal.throwIfAborted();

      return await new Promise<string>((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );

        deferredLoad.promise.then(resolve, reject);
      });
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      gcTime: 1_000,
      loader,
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(AutoAttachProbe, {
      target,
      props: {
        query,
      },
    });

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
    });

    unmount(app);
    target.remove();

    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(false);

    deferredLoad.resolve('ok');

    await waitFor(() => {
      expect(query.watch()).toBe('ok');
    });

    expect(signals[0]?.aborted).toBe(false);
  });

  it('auto-attach inf() unmount preserves an in-flight fetch to warm the cache (forkPreload)', async () => {
    const queryClient = createQueryClient();
    const deferredLoad = deferred<{ id: number }>();
    const signals: AbortSignal[] = [];

    const loader = vi.fn(async ({ signal }: SingleLoaderContext<number>) => {
      signals.push(signal);
      signal.throwIfAborted();

      return await new Promise<{ id: number }>((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );

        deferredLoad.promise.then(resolve, reject);
      });
    });

    const query = single<{ id: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      gcTime: 1_000,
      loader,
      initialPageParam: 1,
    });

    const inf = query.inf();

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(AutoAttachProbe, {
      target,
      props: {
        query: inf,
      },
    });

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
    });

    unmount(app);
    target.remove();

    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(false);

    deferredLoad.resolve({ id: 1 });

    await waitFor(() => {
      expect(inf.watch()?.pages).toEqual([{ id: 1 }]);
    });

    expect(signals[0]?.aborted).toBe(false);
  });

  it('auto-attach preserves an in-flight fetch when the reactive branch changes', async () => {
    const queryClient = createQueryClient();

    const signals: AbortSignal[] = [];
    const reply = deferred<string>();

    const loader = vi.fn(async ({ signal }: SingleLoaderContext) => {
      signals.push(signal);
      signal.throwIfAborted();

      return await new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        reply.promise.then(resolve, reject);
      });
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(LoadingSwitchProbe, {
      target,
      props: {
        query,
      },
    });

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => expect(target.querySelector('[data-testid="loading"]')).not.toBeNull());
    expect(loader).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    reply.resolve('ok');
    await waitFor(() => {
      expect(query.watch()).toBe('ok');
    });

    unmount(app);
    target.remove();
  });

  it('load() returns data and caches it without attachment', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    const value = await query.load();

    expect(value).toBe('ok');
    expect(query.watch()).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('load() without refresh uses a fresh cache', async () => {
    const queryClient = createQueryClient();
    let callIndex = 0;
    const loader = vi.fn(async () => {
      callIndex += 1;
      return `ok-${callIndex}`;
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    const v1 = await query.load();
    const v2 = await query.load();

    expect(v1).toBe('ok-1');
    expect(v2).toBe('ok-1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('load({ refresh: true }) refetches even with a fresh cache', async () => {
    const queryClient = createQueryClient();
    let callIndex = 0;
    const loader = vi.fn(async () => {
      callIndex += 1;
      return `ok-${callIndex}`;
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    await query.load();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(query.watch()).toBe('ok-1');

    await query.load({ refresh: true });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(query.watch()).toBe('ok-2');
  });

  it('refresh answers from a request sent after it, not from the one already in flight', async () => {
    const queryClient = createQueryClient();
    const replies = [deferred<string>(), deferred<string>()];
    let calls = 0;

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => await replies[calls++]!.promise,
    });

    const earlier = query.load();
    const joined = query.loadOrThrow();
    const forced = query.loadOrThrow({ refresh: true });
    replies[0]!.resolve('before-write');
    replies[1]!.resolve('after-write');

    await expect(forced).resolves.toBe('after-write');
    await expect(earlier).resolves.toBe('after-write');
    await expect(joined).resolves.toBe('after-write');
    expect(calls).toBe(2);
    expect(query.watch()).toBe('after-write');
  });

  it('loadOrThrow() throws the loader error by default', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    await expect(query.loadOrThrow()).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cancel() aborts an active load()', async () => {
    const queryClient = createQueryClient();
    const aborted = vi.fn();

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: ({ signal }: SingleLoaderContext) =>
        new Promise<string>((_resolve, reject) => {
          if (signal.aborted) {
            aborted();
            reject(new Error('aborted'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });

    const loadPromise = query.load({ refresh: true });
    await query.cancel();
    const result = await loadPromise;

    expect(result).toBeUndefined();
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('cancel() without an active fetch is a no-op', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    await query.cancel();
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it('invalidate() marks stale and the next load() refetches', async () => {
    const queryClient = createQueryClient();
    let callIndex = 0;
    const loader = vi.fn(async () => {
      callIndex += 1;
      return `ok-${callIndex}`;
    });

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    await query.load();
    expect(query.watch()).toBe('ok-1');
    expect(loader).toHaveBeenCalledTimes(1);

    await query.invalidate();
    await query.load();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(query.watch()).toBe('ok-2');
  });

  it('setCache() updates the cache', () => {
    const queryClient = createQueryClient();

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 'ignored',
    });

    query.setCache('a');
    expect(query.watch()).toBe('a');
  });

  it('page() load() returns data, preserves page and passes pageSize', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ pageParam, pageSize }: SingleLoaderContext<number>) => {
      return { page: pageParam ?? 0, pageSize };
    });

    const query = single<{ page: number; pageSize?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const page1 = query.page({ page: 1, pageSize: 10 });
    const value = await page1.load();

    expect(page1.page).toBe(1);
    expect(value).toEqual({ page: 1, pageSize: 10 });
    expect(loader).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'page',
        pageParam: 1,
        pageSize: 10,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('page() returns the same instance for identical options', () => {
    const queryClient = createQueryClient();

    const query = single<number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 1,
    });

    const p1 = query.page({ page: 1, pageSize: 10 });
    const p1b = query.page({ page: 1, pageSize: 10 });
    const p2 = query.page({ page: 2, pageSize: 10 });

    expect(p1).toBe(p1b);
    expect(p2).not.toBe(p1);
  });

  it('inf() load() uses initialPageParam and supports fetchNextPage()', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => {
      const page = pageParam ?? 0;
      return { id: page, next: page < 2 ? page + 1 : undefined };
    });

    const query = single<{ id: number; next?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.next,
    });

    const inf = query.inf();
    const stop = observe(() => inf.data);

    await waitFor(() => {
      expect(inf.watch()?.pages.length).toBe(1);
    });

    expect(inf.hasNextPage).toBe(true);

    await inf.fetchNextPage();

    expect(inf.watch()?.pages.length).toBe(2);
    expect(inf.hasNextPage).toBe(false);
    stop();
  });

  it('enabled: false prevents automatic loading on observation', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      enabled: false,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    await flush();
    expect(loader).toHaveBeenCalledTimes(0);
    expect(query.watch()).toBeUndefined();

    stop();
  });

  it('refetchInterval refetches periodically', async () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();
    let counter = 0;
    const loader = vi.fn(async () => {
      counter += 1;
      return counter;
    });

    const query = single<number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      refetchInterval: 25,
      staleTime: 0,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    await vi.advanceTimersByTimeAsync(0);
    expect(query.watch()).toBe(1);

    await vi.advanceTimersByTimeAsync(25);
    expect(query.watch()).toBe(2);
    stop();
  });

  it('refetchOnWindowFocus refetches when focus returns', async () => {
    const queryClient = createQueryClient();
    let counter = 0;
    const loader = vi.fn(async () => {
      counter += 1;
      return counter;
    });

    const query = single<number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 0,
      refetchOnWindowFocus: true,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    await waitFor(() => {
      expect(query.watch()).toBe(1);
    });

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => {
      expect(query.watch()).toBe(2);
    });

    stop();
  });

  it('refetchOnReconnect refetches when the network returns', async () => {
    const queryClient = createQueryClient();
    let counter = 0;
    const loader = vi.fn(async () => {
      counter += 1;
      return counter;
    });

    const query = single<number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 0,
      refetchOnReconnect: true,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    await waitFor(() => {
      expect(query.watch()).toBe(1);
    });

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await waitFor(() => {
      expect(query.watch()).toBe(2);
    });

    stop();
  });

  it('inf() isFetchingNextPage tracks the request', async () => {
    const queryClient = createQueryClient();
    const d = deferred<{ id: number; next?: number }>();
    let callIndex = 0;

    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => {
      callIndex += 1;
      const page = pageParam ?? 0;
      if (callIndex === 1) return { id: page, next: 2 };
      return await d.promise;
    });

    const query = single<{ id: number; next?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.next,
    });

    const inf = query.inf();
    const stop = observe(() => inf.data);

    await waitFor(() => {
      expect(inf.watch()?.pages.length).toBe(1);
    });

    expect(inf.isFetchingNextPage).toBe(false);

    const p = inf.fetchNextPage();
    await Promise.resolve();

    expect(inf.isFetchingNextPage).toBe(true);

    d.resolve({ id: 2 });
    await p;

    expect(inf.isFetchingNextPage).toBe(false);
    stop();
  });

  it('promise starts loading outside a component and resolves with data', async () => {
    const queryClient = createQueryClient();
    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 'ok',
    });

    await expect(query.promise).resolves.toBe('ok');
  });

  it('promise starts loading and deduplicates the in-flight request (static)', async () => {
    const queryClient = createQueryClient();
    const d = deferred<string>();
    const loader = vi.fn(async () => await d.promise);

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      enabled: false,
      loader: async ({ signal }: SingleLoaderContext) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const stop = observe(() => query.data);

    expect(loader).toHaveBeenCalledTimes(0);

    const p1 = query.promise;
    const p2 = query.promise;

    expect(p1).toBe(p2);
    expect(loader).toHaveBeenCalledTimes(1);

    d.resolve('ok');
    await expect(p1).resolves.toBe('ok');

    stop();
  });
});

describe('single().all()', () => {
  it('all().invalidate() marks the base query and infinite children stale', async () => {
    const queryClient = createQueryClient();

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      gcTime: 60_000,
      initialPageParam: 1,
      loader: async () => 'ok',
    });

    await query.load();
    const inf = query.inf();
    await inf.load();

    expect(queryClient.getQueryState(['Test'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(['Test', 'inf', null, 1])?.isInvalidated).toBe(false);

    await query.all().invalidate({ refetchType: 'none' });

    expect(queryClient.getQueryState(['Test'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['Test', 'inf', null, 1])?.isInvalidated).toBe(true);
  });

  it('all().reset() removes the base query and infinite children from cache', async () => {
    const queryClient = createQueryClient();

    const query = single<string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      gcTime: 60_000,
      initialPageParam: 1,
      loader: async () => 'ok',
    });

    await query.load();
    const inf = query.inf();
    await inf.load();

    expect(query.watch()).toBe('ok');
    expect(inf.watch()).toBeDefined();

    query.all().reset();

    expect(query.watch()).toBeUndefined();
    expect(inf.watch()).toBeUndefined();

    await expect(query.load()).resolves.toBe('ok');
    await expect(inf.load()).resolves.toMatchObject({ pages: ['ok'] });
  });
});

describe('query lifecycle regressions', () => {
  it('imperative load resumes after offline to online without component attachment', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'online');
    const query = single<string>({ name: 'OfflineLoad', queryClient, scope: Scope.make(), loader });

    onlineManager.setOnline(false);
    const promise = query.loadOrThrow();

    await waitFor(() => {
      expect(queryClient.getQueryState(['OfflineLoad'])?.fetchStatus).toBe('paused');
    });
    expect(loader).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await expect(promise).resolves.toBe('online');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('imperative infinite load resumes after offline to online without component attachment', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ pageParam }: SingleLoaderContext<number>) => `page-${pageParam}`);
    const query = single<string, Error, number>({
      name: 'OfflineInfiniteLoad',
      queryClient,
      scope: Scope.make(),
      initialPageParam: 1,
      loader,
    }).inf();

    onlineManager.setOnline(false);
    const promise = query.loadOrThrow();

    await waitFor(() => {
      expect(queryClient.getQueryState(['OfflineInfiniteLoad', 'inf', null, 1])?.fetchStatus).toBe('paused');
    });
    expect(loader).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await expect(promise).resolves.toEqual({ pages: ['page-1'], pageParams: [1] });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('the final detach does not leave a static or infinite fetch paused without an app host', async () => {
    const queryClient = createQueryClient();
    const staticLoader = vi.fn(async () => 'static-online');
    const infiniteLoader = vi.fn(async () => 'infinite-online');
    const base = single<string>({ name: 'DetachedPaused', queryClient, scope: Scope.make(), gcTime: 60_000, loader: staticLoader });
    const inf = single<string, Error, number>({
      name: 'DetachedPausedInf',
      queryClient,
      scope: Scope.make(),
      gcTime: 60_000,
      initialPageParam: 1,
      loader: infiniteLoader,
    }).inf();

    onlineManager.setOnline(false);
    const stopBase = observe(() => base.data);
    const stopInf = observe(() => inf.data);
    await waitFor(() => {
      expect(queryClient.getQueryState(['DetachedPaused'])?.fetchStatus).toBe('paused');
      expect(queryClient.getQueryState(['DetachedPausedInf', 'inf', null, 1])?.fetchStatus).toBe('paused');
    });

    stopBase();
    stopInf();

    onlineManager.setOnline(true);

    await waitFor(() => {
      expect(base.watch()).toBe('static-online');
      expect(inf.watch()?.pages).toEqual(['infinite-online']);
    });
    expect(staticLoader).toHaveBeenCalledTimes(1);
    expect(infiniteLoader).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(observersCount(queryClient, ['DetachedPaused'])).toBe(0);
      expect(observersCount(queryClient, ['DetachedPausedInf', 'inf', null, 1])).toBe(0);
    });
  });

  it('static and infinite queries rebind after gcTime', async () => {
    const queryClient = createQueryClient();
    let staticRevision = 0;
    let infiniteRevision = 0;

    const staticQuery = single<string>({
      name: 'StaticGc',
      queryClient,
      scope: Scope.make(),
      gcTime: 10,
      staleTime: Infinity,
      loader: async () => `v${++staticRevision}`,
    });
    const infiniteQuery = single<string, Error, number>({
      name: 'InfiniteGc',
      queryClient,
      scope: Scope.make(),
      gcTime: 10,
      staleTime: Infinity,
      initialPageParam: 1,
      loader: async () => `v${++infiniteRevision}`,
    }).inf();

    const firstStop = observe(() => staticQuery.data);
    const firstInfStop = observe(() => infiniteQuery.data);
    await waitFor(() => {
      expect(staticQuery.watch()).toBe('v1');
      expect(infiniteQuery.watch()?.pages).toEqual(['v1']);
    });
    firstStop();
    firstInfStop();

    await waitFor(() => {
      expect(queryClient.getQueryState(['StaticGc'])).toBeUndefined();
      expect(queryClient.getQueryState(['InfiniteGc', 'inf', null, 1])).toBeUndefined();
    });

    const secondStop = observe(() => staticQuery.data);
    const secondInfStop = observe(() => infiniteQuery.data);
    await waitFor(() => {
      expect(staticQuery.watch()).toBe('v2');
      expect(infiniteQuery.watch()?.pages).toEqual(['v2']);
    });

    expect(staticQuery.data).toBe(staticQuery.watch());
    expect(infiniteQuery.data).toEqual(infiniteQuery.watch());
    expect(staticRevision).toBe(2);
    expect(infiniteRevision).toBe(2);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['StaticGc'], exact: true })).toHaveLength(1);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['InfiniteGc', 'inf', null, 1], exact: true })).toHaveLength(1);

    secondStop();
    secondInfStop();
  });

  it('active static and infinite observers survive external removeQueries without stale state', async () => {
    const queryClient = createQueryClient();
    let staticRevision = 0;
    let infiniteRevision = 0;
    const base = single<string>({
      name: 'ActiveRebind',
      queryClient,
      scope: Scope.make(),
      staleTime: Infinity,
      loader: async () => `s${++staticRevision}`,
    });
    const inf = single<string, Error, number>({
      name: 'ActiveInfRebind',
      queryClient,
      scope: Scope.make(),
      staleTime: Infinity,
      initialPageParam: 1,
      loader: async () => `i${++infiniteRevision}`,
    }).inf();

    const stopBase = observe(() => base.data);
    const stopInf = observe(() => inf.data);
    await waitFor(() => {
      expect(base.watch()).toBe('s1');
      expect(inf.watch()?.pages).toEqual(['i1']);
    });

    queryClient.removeQueries({ queryKey: ['ActiveRebind'], exact: true });
    queryClient.removeQueries({ queryKey: ['ActiveInfRebind', 'inf', null, 1], exact: true });

    await waitFor(() => {
      expect(base.watch()).toBe('s2');
      expect(inf.watch()?.pages).toEqual(['i2']);
    });
    expect(observersCount(queryClient, ['ActiveRebind'])).toBe(1);
    expect(observersCount(queryClient, ['ActiveInfRebind', 'inf', null, 1])).toBe(1);
    expect(base.data).toBe(base.watch());
    expect(inf.data).toEqual(inf.watch());
    expect(staticRevision).toBe(2);
    expect(infiniteRevision).toBe(2);

    stopBase();
    stopInf();
  });
});

describe('single: scope', () => {
  it('closing the scope with live readers makes the query terminal', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const loader = vi.fn(async () => 'ok');
    const query = single<string>({ name: 'Test', queryClient, scope, enabled: false, loader });

    const stopFirst = observe(() => query.data);
    const stopSecond = observe(() => query.data);
    expect(observersCount(queryClient, ['Test'])).toBe(1);

    await scope.close();

    expect(queryClient.getQueryCache().find({ queryKey: ['Test'], exact: true })).toBeUndefined();
    await expect(query.load()).resolves.toBeUndefined();
    expect(query.data).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();

    stopFirst();
    stopSecond();
  });

  it('a closed scope makes load/invalidate/cancel no-ops and removes the query from cache', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const loader = vi.fn(async () => 'ok');
    const query = single<string>({ name: 'Test', queryClient, scope, loader });

    await query.load();
    expect(query.watch()).toBe('ok');

    await scope.close();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');

    expect(queryClient.getQueryCache().find({ queryKey: ['Test'], exact: true })).toBeUndefined();
    await query.load();
    await query.invalidate();
    await query.cancel();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(0);
    expect(cancelSpy).toHaveBeenCalledTimes(0);
  });

  it('promise throws ScopeAbort after the scope closes', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const query = single<string>({ name: 'Test', queryClient, scope, loader: async () => 'ok' });

    await scope.close();

    expect(() => query.promise).toThrow(/closed/i);
  });

  it('closing the scope ends base, page and infinite queries together', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const loader = vi.fn(async ({ type }: SingleLoaderContext<number>) => type);
    const query = single<string, Error, number>({ name: 'CloseAll', queryClient, scope, initialPageParam: 1, loader });
    const page = query.page({ page: 2 });
    const inf = query.inf();
    await Promise.all([query.load(), page.load(), inf.load()]);

    await scope.close();
    const callsAfterClose = loader.mock.calls.length;

    await expect(query.load()).resolves.toBeUndefined();
    await expect(page.load()).resolves.toBeUndefined();
    await expect(inf.load()).resolves.toBeUndefined();
    expect(() => query.page({ page: 3 })).toThrow(/closed/i);
    expect(() => query.inf()).toThrow(/closed/i);
    await inf.fetchNextPage();
    expect(loader).toHaveBeenCalledTimes(callsAfterClose);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['CloseAll'] })).toHaveLength(0);
  });
});

describe('single: live', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads with no reader and keeps its schedule only while the tab is visible', async () => {
    vi.useFakeTimers();
    const scope = Scope.make();
    const loader = vi.fn(async () => 'ok');
    const query = single<string>({
      name: 'Live',
      queryClient: createQueryClient(),
      scope,
      loader,
      live: true,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(query.watch()).toBe('ok');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(loader).toHaveBeenCalledTimes(2);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(loader).toHaveBeenCalledTimes(2);

    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(3);

    await scope.close();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('keeps its schedule after the last reader leaves', async () => {
    vi.useFakeTimers();
    const scope = Scope.make();
    const loader = vi.fn(async () => 'ok');
    const query = single<string>({
      name: 'LiveReaderLeaves',
      queryClient: createQueryClient(),
      scope,
      loader,
      live: true,
      refetchInterval: 15_000,
    });
    const stop = observe(() => query.data);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(loader).toHaveBeenCalledTimes(2);

    await scope.close();
  });
});
