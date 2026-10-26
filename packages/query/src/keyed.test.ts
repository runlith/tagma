import { QueryClient, focusManager, notifyManager, onlineManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoAttachProbe from './test-utils/AutoAttachProbe.svelte';
import { observe, observeDerived, observersCount } from './test-utils/observe.svelte.js';
import { mount, unmount } from 'svelte';
import { keyed } from './builders/keyed.js';
import type { KeyedLoaderContext } from './types.js';

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
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

describe('keyed', () => {
  it('caches query instances by primitive key', () => {
    const queryClient = createQueryClient();

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 'ok',
    });

    const r1 = repo.key(1);
    const r1b = repo.key(1);
    const r2 = repo.key(2);

    expect(r1).toBe(r1b);
    expect(r2).not.toBe(r1);
  });

  it('caches query instances by deeply equal object key', () => {
    const queryClient = createQueryClient();

    type Key = { groupId: number; kind: string };
    const repo = keyed<Key, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key }: KeyedLoaderContext<Key>) => `${key.kind}:${key.groupId}`,
    });

    const a: Key = { groupId: 1, kind: 'daily' };
    const b = (() => {
      const obj: Record<string, unknown> = {};
      obj.kind = 'daily';
      obj.groupId = 1;
      return obj as Key;
    })();

    const r1 = repo.key(a);
    const r2 = repo.key(b);

    expect(r1).toBe(r2);
  });

  it('different object keys produce different query instances', () => {
    const queryClient = createQueryClient();

    type Key = { groupId: number };
    const repo = keyed<Key, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key }: KeyedLoaderContext<Key>) => String(key.groupId),
    });

    const r1 = repo.key({ groupId: 1 });
    const r2 = repo.key({ groupId: 2 });
    expect(r1).not.toBe(r2);
  });

  it('watch() does not trigger loading for key()', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);
    expect(r1.watch()).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it('reset() clears key/page/infinite caches without destroying the family', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key, type }: KeyedLoaderContext<number>) => `${type}-${key}`);

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async (context) => {
        context.signal.throwIfAborted();
        return await loader(context);
      },
      initialPageParam: 1,
    });

    const r1 = repo.key(1);
    const page1 = r1.page({ page: 1 });
    const inf1 = r1.inf({ initialPageParam: 1 });

    await r1.load();
    await page1.load();
    await inf1.load();

    expect(r1.watch()).toBe('static-1');
    expect(page1.watch()).toBe('page-1');
    expect(inf1.watch()?.pages).toEqual(['inf-1']);

    repo.reset();

    expect(r1.watch()).toBeUndefined();
    expect(page1.watch()).toBeUndefined();
    expect(inf1.watch()).toBeUndefined();

    await r1.load();
    expect(r1.watch()).toBe('static-1');
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('an unreactive read returns the cache without subscribing (keyed)', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');
    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const r1 = repo.key(1);

    expect(r1.data).toBeUndefined();
    expect(observersCount(queryClient, ['Test', 1])).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });

  it('a reactive reader outside a component subscribes and loads (keyed)', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async (key: number) => `ok-${key}`);

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key, signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader(key);
      },
    });

    const r1 = repo.key(1);
    const stop = observe(() => r1.data);

    await vi.waitFor(() => {
      expect(r1.watch()).toBe('ok-1');
    });

    expect(observersCount(queryClient, ['Test', 1])).toBe(1);
    stop();
    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test', 1])).toBe(0);
    });
  });

  it('a key first built inside a derived updates that derived when its answer lands', async () => {
    const repo = keyed<number, string>({
      name: 'Test',
      queryClient: createQueryClient(),
      scope: Scope.make(),
      loader: async ({ key }: KeyedLoaderContext<number>) => `ok-${key}`,
    });

    const reader = observeDerived(() => repo.key(1).data);

    await vi.waitFor(() => {
      expect(reader.latest()).toBe('ok-1');
    });
    reader.stop();
  });

  it('auto-attach inside a component works for key()', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'ok');

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(AutoAttachProbe, {
      target,
      props: {
        query: r1,
      },
    });

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test', 1])).toBe(1);
    });

    await vi.waitFor(() => {
      expect(r1.watch()).toBe('ok');
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(observersCount(queryClient, ['Test', 1])).toBe(1);

    unmount(app);
    target.remove();

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test', 1])).toBe(0);
    });
  });

  it('auto-attach with staleTime=0 refetches on remount even with cached data (keyed)', async () => {
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

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 0,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);

    const mountProbe = () => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const app = mount(AutoAttachProbe, {
        target,
        props: {
          query: r1,
        },
      });

      return { app, target };
    };

    const first = mountProbe();

    await vi.waitFor(() => {
      expect(r1.watch()).toBe('ok-1');
    });
    expect(loader).toHaveBeenCalledTimes(1);

    unmount(first.app);
    first.target.remove();

    await vi.waitFor(() => {
      expect(observersCount(queryClient, ['Test', 1])).toBe(0);
    });

    await new Promise((r) => setTimeout(r, 5));

    const second = mountProbe();

    await vi.waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(r1.watch()).toBe('ok-2');
    });

    unmount(second.app);
    second.target.remove();
  });

  it('load() returns and caches data for one key', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async (key: number) => `ok-${key}`);

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key, signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader(key);
      },
      staleTime: 60_000,
    });

    const r1 = repo.key(1);
    const value = await r1.load();

    expect(value).toBe('ok-1');
    expect(r1.watch()).toBe('ok-1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loadOrThrow() throws the loader error by default (for one key)', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);
    await expect(r1.loadOrThrow()).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('concurrent load() calls for one key are deduplicated', async () => {
    const queryClient = createQueryClient();
    const d = deferred<string>();
    const loader = vi.fn(async () => await d.promise);

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
      staleTime: 60_000,
    });

    const r1 = repo.key(1);
    const p1 = r1.load();
    const p2 = r1.load();

    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    d.resolve('ok');
    const [v1, v2] = await Promise.all([p1, p2]);

    expect(v1).toBe('ok');
    expect(v2).toBe('ok');
    expect(r1.watch()).toBe('ok');
  });

  it('concurrent load() calls for different keys remain independent', async () => {
    const queryClient = createQueryClient();
    const d1 = deferred<string>();
    const d2 = deferred<string>();

    const loader = vi.fn(async (key: number) => {
      return await (key === 1 ? d1.promise : d2.promise);
    });

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async ({ key, signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader(key);
      },
    });

    const r1 = repo.key(1);
    const r2 = repo.key(2);

    const p1 = r1.load();
    const p2 = r2.load();

    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(2);

    d1.resolve('v1');
    d2.resolve('v2');

    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toBe('v1');
    expect(v2).toBe('v2');
    expect(r1.watch()).toBe('v1');
    expect(r2.watch()).toBe('v2');
  });

  it('load() without refresh uses a fresh cache', async () => {
    const queryClient = createQueryClient();
    let callIndex = 0;
    const loader = vi.fn(async () => {
      callIndex += 1;
      return `ok-${callIndex}`;
    });

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);
    const v1 = await r1.load();
    const v2 = await r1.load();

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

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);
    await r1.load();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(r1.watch()).toBe('ok-1');

    await r1.load({ refresh: true });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(r1.watch()).toBe('ok-2');
  });

  it('invalidate() marks stale and the next load() refetches', async () => {
    const queryClient = createQueryClient();
    let callIndex = 0;
    const loader = vi.fn(async () => {
      callIndex += 1;
      return `ok-${callIndex}`;
    });

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader();
      },
    });

    const r1 = repo.key(1);
    await r1.load();
    expect(r1.watch()).toBe('ok-1');

    await r1.invalidate();
    await r1.load();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(r1.watch()).toBe('ok-2');
  });

  it('cancel() aborts an active load()', async () => {
    const queryClient = createQueryClient();
    const aborted = vi.fn();

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: ({ signal }: KeyedLoaderContext<number>) =>
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

    const r1 = repo.key(1);
    const p = r1.load({ refresh: true });
    await r1.cancel();
    const result = await p;

    expect(result).toBeUndefined();
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('setCache() updates the cache for one key', () => {
    const queryClient = createQueryClient();
    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 'ignored',
    });

    const r1 = repo.key(1);

    r1.setCache('a');
    expect(r1.watch()).toBe('a');
  });

  it('page() load() passes key, page and pageSize and caches instances', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key, pageParam, pageSize }: KeyedLoaderContext<number, number>) => {
      return { key, page: pageParam ?? 0, pageSize };
    });

    const repo = keyed<number, { key: number; page: number; pageSize?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const r1 = repo.key(1);
    const page = r1.page({ page: 2, pageSize: 10 });
    const page2 = r1.page({ page: 2, pageSize: 10 });
    expect(page).toBe(page2);

    const value = await page.load();
    expect(page.page).toBe(2);
    expect(value).toEqual({ key: 1, page: 2, pageSize: 10 });
    expect(loader).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 1,
        type: 'page',
        pageParam: 2,
        pageSize: 10,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('page() loads different pages independently', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key, pageParam }: KeyedLoaderContext<number, number>) => {
      return `${key}:${pageParam ?? 0}`;
    });

    const repo = keyed<number, string, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const r1 = repo.key(1);
    const p1 = r1.page({ page: 1 });
    const p2 = r1.page({ page: 2 });

    const [v1, v2] = await Promise.all([p1.load(), p2.load()]);
    expect(v1).toBe('1:1');
    expect(v2).toBe('1:2');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('inf() load() uses initialPageParam and supports fetchNextPage()', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key, pageParam }: KeyedLoaderContext<number, number>) => {
      const page = pageParam ?? 0;
      return { key, id: page, next: page < 2 ? page + 1 : undefined };
    });

    const repo = keyed<number, { key: number; id: number; next?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.next,
    });

    const inf = repo.key(1).inf();
    const stop = observe(() => inf.data);

    await vi.waitFor(() => {
      expect(inf.watch()?.pages.length).toBe(1);
    });

    expect(inf.hasNextPage).toBe(true);
    await inf.fetchNextPage();
    expect(inf.watch()?.pages.length).toBe(2);
    expect(inf.hasNextPage).toBe(false);
    stop();
  });

  it('inf() requires initialPageParam without inventing a numeric cursor', () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => ({ cursor: 'unused' }));
    const repo = keyed<number, { cursor: string }, Error, string>({
      name: 'RequiredKeyedCursor',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    expect(() => repo.key(1).inf()).toThrow(/initialPageParam/i);
    expect(loader).not.toHaveBeenCalled();
  });

  it('inf() separates keyed queries with different string initialPageParam values', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async ({ key, pageParam }: KeyedLoaderContext<number, string>) => ({ key, cursor: pageParam }));
    const repo = keyed<number, { key: number; cursor?: string }, Error, string>({
      name: 'KeyedStringCursor',
      queryClient,
      scope: Scope.make(),
      loader,
    });

    const first = repo.key(1).inf({ initialPageParam: 'first', pageSize: 20 });
    const second = repo.key(1).inf({ initialPageParam: 'second', pageSize: 20 });

    expect(first).not.toBe(second);
    await expect(first.loadOrThrow()).resolves.toEqual({
      pages: [{ key: 1, cursor: 'first' }],
      pageParams: ['first'],
    });
    await expect(second.loadOrThrow()).resolves.toEqual({
      pages: [{ key: 1, cursor: 'second' }],
      pageParams: ['second'],
    });
  });

  it('inf() isFetchingNextPage tracks the request', async () => {
    const queryClient = createQueryClient();
    const d = deferred<{ id: number; next?: number }>();
    let callIndex = 0;

    const loader = vi.fn(async ({ pageParam }: KeyedLoaderContext<number, number>) => {
      callIndex += 1;
      const page = pageParam ?? 0;
      if (callIndex === 1) return { id: page, next: 2 };
      return await d.promise;
    });

    const repo = keyed<number, { id: number; next?: number }, Error, number>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader,
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.next,
    });

    const inf = repo.key(1).inf();
    const stop = observe(() => inf.data);

    await vi.waitFor(() => {
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

  it('all().invalidate() refetches every active key', async () => {
    const queryClient = createQueryClient();
    let counter = 0;
    const loader = vi.fn(async (key: number) => {
      counter += 1;
      return `${key}:${counter}`;
    });

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: Infinity,
      loader: async ({ key, signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader(key);
      },
    });

    const r1 = repo.key(1);
    const r2 = repo.key(2);
    const stopFirst = observe(() => r1.data);
    const stopSecond = observe(() => r2.data);

    await vi.waitFor(() => {
      expect(r1.watch()).toBeDefined();
      expect(r2.watch()).toBeDefined();
    });

    const before1 = r1.watch();
    const before2 = r2.watch();

    await repo.all().invalidate({ refetchType: 'all' });

    await vi.waitFor(() => {
      expect(r1.watch()).not.toBe(before1);
      expect(r2.watch()).not.toBe(before2);
    });

    expect(loader.mock.calls.length).toBeGreaterThanOrEqual(4);

    stopFirst();
    stopSecond();
  });

  it('where(match).invalidate() refetches the matching keys and leaves the others fresh', async () => {
    const queryClient = createQueryClient();
    const asked: number[] = [];
    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      staleTime: Infinity,
      loader: async ({ key }: KeyedLoaderContext<number>) => {
        asked.push(key);
        return `${key}:${asked.length}`;
      },
    });
    const queries = [1, 2, 3].map((key) => repo.key(key));
    const stops = queries.map((query) => observe(() => query.data));
    await vi.waitFor(() => expect(queries.every((query) => query.watch() !== undefined)).toBe(true));

    await repo.where((key) => key !== 2).invalidate();

    await vi.waitFor(() => expect(asked.slice(3).toSorted()).toEqual([1, 3]));
    expect(queries[1]?.watch()).toBe(`2:${asked.indexOf(2) + 1}`);
    expect(queries[1]?.isStale).toBe(false);
    for (const stop of stops) stop();
  });

  it('promise starts loading outside a component and resolves with data (keyed)', async () => {
    const queryClient = createQueryClient();
    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      loader: async () => 'ok',
    });

    await expect(repo.key(1).promise).resolves.toBe('ok');
  });

  it('promise starts loading and deduplicates the in-flight request (keyed static)', async () => {
    const queryClient = createQueryClient();
    const d = deferred<string>();
    const loader = vi.fn(async (key: number) => `ok-${key}:${await d.promise}`);

    const repo = keyed<number, string>({
      name: 'Test',
      queryClient,
      scope: Scope.make(),
      enabled: false,
      loader: async ({ key, signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await loader(key);
      },
    });

    const r1 = repo.key(1);
    const stop = observe(() => r1.data);

    expect(loader).toHaveBeenCalledTimes(0);

    const p1 = r1.promise;
    const p2 = r1.promise;

    expect(p1).toBe(p2);
    expect(loader).toHaveBeenCalledTimes(1);

    d.resolve('x');
    await expect(p1).resolves.toBe('ok-1:x');

    stop();
  });
});

describe('keyed: scope', () => {
  it('closing the scope with live readers makes the keyed query terminal', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const loader = vi.fn(async () => 'ok');
    const repo = keyed<number, string>({ name: 'Test', queryClient, scope, enabled: false, loader });

    const r1 = repo.key(1);
    const stopFirst = observe(() => r1.data);
    const stopSecond = observe(() => r1.data);
    expect(observersCount(queryClient, ['Test', 1])).toBe(1);

    await scope.close();

    expect(observersCount(queryClient, ['Test', 1])).toBe(0);
    await expect(r1.load()).resolves.toBeUndefined();
    expect(r1.data).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();

    stopFirst();
    stopSecond();
  });

  it('closing the scope removes every family query and key() then throws ScopeAbort', async () => {
    const queryClient = createQueryClient();
    const scope = Scope.make();
    const loader = vi.fn(async ({ key, type, pageParam }: KeyedLoaderContext<number, number>) => `${key}:${type}:${pageParam ?? 0}`);
    const repo = keyed<number, string, Error, number>({ name: 'CloseFamily', queryClient, scope, initialPageParam: 1, loader });
    const r1 = repo.key(1);
    const page = r1.page({ page: 2 });
    const inf = r1.inf();
    await Promise.all([r1.load(), page.load(), inf.load()]);
    expect(queryClient.getQueryCache().findAll({ queryKey: ['CloseFamily'] })).toHaveLength(3);

    await scope.close();

    expect(queryClient.getQueryCache().findAll({ queryKey: ['CloseFamily'] })).toHaveLength(0);
    await expect(r1.load()).resolves.toBeUndefined();
    await expect(page.load()).resolves.toBeUndefined();
    expect(() => repo.key(1)).toThrow(/closed/i);
    expect(() => r1.page({ page: 3 })).toThrow(/closed/i);
  });
});

describe('keyed: live', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds every key from its first use to the end of the scope, reader or not', async () => {
    vi.useFakeTimers();
    const scope = Scope.make();
    const loader = vi.fn(async ({ key }: KeyedLoaderContext<string>) => key);
    const family = keyed<string, string>({
      name: 'LiveKeyed',
      queryClient: createQueryClient(),
      scope,
      loader,
      live: true,
      refetchInterval: 15_000,
    });

    family.key('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(loader).toHaveBeenCalledTimes(2);

    await scope.close();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
