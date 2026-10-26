import { QueryClient, notifyManager } from '@tanstack/query-core';
import { mount, unmount, type ComponentProps } from 'svelte';
import { Scope } from '@runlith/layer/Scope';
import { describe, expect, it, vi } from 'vitest';

import { single } from './builders/single.js';
import UnobservedReadProbe from './test-utils/UnobservedReadProbe.svelte';
import UnobservedInfReadProbe from './test-utils/UnobservedInfReadProbe.svelte';

notifyManager.setScheduler((callback) => callback());

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

type Read = { data: unknown; watch: unknown; isSuccess: boolean };

async function readWithoutSubscription(query: ReturnType<typeof single<string>>): Promise<Read> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  let read: Read | undefined;
  const app = mount(UnobservedReadProbe, {
    target,
    props: { query, onRead: (value: Read) => (read = value) },
  });

  await unmount(app);
  target.remove();

  if (!read) throw new Error('probe did not read the query');
  return read;
}

type InfRead = { data: unknown; watch: unknown; isSuccess: boolean; hasNextPage: boolean };

async function readInfWithoutSubscription(query: ComponentProps<typeof UnobservedInfReadProbe>['query']): Promise<InfRead> {
  const target = document.createElement('div');
  document.body.appendChild(target);

  let read: InfRead | undefined;
  const app = mount(UnobservedInfReadProbe, {
    target,
    props: { query, onRead: (value: InfRead) => (read = value) },
  });

  await unmount(app);
  target.remove();

  if (!read) throw new Error('probe did not read the query');
  return read;
}

describe('reading a query nothing observes', () => {
  it('answers what the cache holds after an imperative load', async () => {
    const queryClient = createQueryClient();
    const loader = vi.fn(async () => 'loaded');

    const query = single<string>({ name: 'Unobserved', queryClient, scope: Scope.make(), loader });

    await query.load();
    expect(queryClient.getQueryData(['Unobserved'])).toBe('loaded');

    const read = await readWithoutSubscription(query);

    expect(read.watch).toBe('loaded');
    expect(read.data).toBe('loaded');
    expect(read.isSuccess).toBe(true);
  });

  it('answers what the cache holds after a load that ran while the last reader was gone', async () => {
    const queryClient = createQueryClient();
    let answer = 'first';
    const loader = vi.fn(async () => answer);

    const query = single<string>({ name: 'Recycled', queryClient, scope: Scope.make(), loader });

    const first = await readWithoutSubscription(query);
    expect(first.data).toBeUndefined();

    answer = 'second';
    await query.refresh();

    const second = await readWithoutSubscription(query);
    expect(second.watch).toBe('second');
    expect(second.data).toBe('second');
  });

  it('answers what the cache holds for an infinite list too', async () => {
    const queryClient = createQueryClient();

    const source = single<{ items: number[]; next?: number }>({
      name: 'UnobservedPages',
      queryClient,
      scope: Scope.make(),
      initialPageParam: 1,
      getNextPageParam: (page) => page.next,
      loader: async ({ pageParam }) => ({ items: [Number(pageParam)], next: Number(pageParam) + 1 }),
    });

    const list = source.inf();
    await list.load();

    const read = await readInfWithoutSubscription(list);

    expect(read.watch).toBeDefined();
    expect(read.data).toBeDefined();
    expect(read.isSuccess).toBe(true);
    expect(read.hasNextPage).toBe(true);
  });
});
