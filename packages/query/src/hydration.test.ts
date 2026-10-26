import { focusManager, notifyManager, onlineManager, type QueryClient } from '@tanstack/query-core';
import { Scope } from '@runlith/layer/Scope';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { keyed } from './builders/keyed.js';
import type { KeyedLoaderContext } from './types.js';
import { observe } from './test-utils/observe.svelte.js';
import { createQueryClient, dehydrateQueryClient, hydrateQueryClient } from './hydration.js';

notifyManager.setScheduler((callback) => callback());

function makeQueryClient(isBrowser: boolean): QueryClient {
  return createQueryClient({
    isBrowser,
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

beforeEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

describe('hydration', () => {
  it('createQueryClient defaults queries.enabled from isBrowser', () => {
    const server = makeQueryClient(false);
    const client = makeQueryClient(true);

    expect(server.getDefaultOptions().queries?.enabled).toBe(false);
    expect(client.getDefaultOptions().queries?.enabled).toBe(true);
  });

  it('hydrateQueryClient fills the cache and query.data avoids another fetch', async () => {
    const serverQueryClient = makeQueryClient(false);

    const serverLoader = vi.fn(async () => 'server-value');
    const serverRepo = keyed<number, string>({
      name: 'HydrationTest',
      queryClient: serverQueryClient,
      scope: Scope.make(),
      staleTime: 60_000,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await serverLoader();
      },
    });

    const serverQuery = serverRepo.key(1);
    await serverQuery.load();
    expect(serverLoader).toHaveBeenCalledTimes(1);

    const dehydrated = dehydrateQueryClient(serverQueryClient);

    const clientQueryClient = makeQueryClient(true);
    hydrateQueryClient(clientQueryClient, dehydrated);

    const clientLoader = vi.fn(async () => 'client-value');
    const clientScope = Scope.make();
    const clientRepo = keyed<number, string>({
      name: 'HydrationTest',
      queryClient: clientQueryClient,
      scope: clientScope,
      staleTime: 60_000,
      loader: async ({ signal }: KeyedLoaderContext<number>) => {
        signal.throwIfAborted();
        return await clientLoader();
      },
    });

    const clientQuery = clientRepo.key(1);

    const stop = observe(() => clientQuery.data);

    expect(clientQuery.watch()).toBe('server-value');
    expect(clientQuery.data).toBe('server-value');
    expect(clientLoader).toHaveBeenCalledTimes(0);

    stop();
    await clientScope.close();
  });
});
