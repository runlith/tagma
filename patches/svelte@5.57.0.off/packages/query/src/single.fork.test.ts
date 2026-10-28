import { QueryClient, notifyManager } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { waitFor } from '@runlith/testing/flush';
import { flushSync, fork, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import { single } from './builders/single.js';
import ForkRouteProbe from './test-utils/ForkRouteProbe.svelte';
import { observersCount } from './test-utils/observe.svelte.js';
import { createSignal } from './test-utils/signal.svelte.js';
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

describe('single', () => {
  it('fork() discard warms the cache for real navigation (single)', async () => {
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
      gcTime: 30_000,
      staleTime: 30_000,
      loader,
    });

    const route = createSignal<'game' | 'lobby'>('game');

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(ForkRouteProbe, {
      target,
      props: { route, query },
    });

    await new Promise((r) => setTimeout(r, 0));

    const preload = fork(() => {
      route.set('lobby');
    });

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
    });

    preload.discard();

    deferredLoad.resolve('ok');

    await waitFor(() => {
      expect(query.watch()).toBe('ok');
    });

    expect(signals[0]?.aborted).toBe(false);

    flushSync(() => {
      route.set('lobby');
    });

    await waitFor(() => {
      expect(observersCount(queryClient, ['Test'])).toBe(1);
    });

    await waitFor(() => {
      const el = target.querySelector('[data-testid="auto-attach"]');
      expect(el?.textContent).toBe('ok');
    });

    unmount(app);
    target.remove();
  });
});
