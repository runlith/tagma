import { QueryClient, notifyManager } from '@tanstack/query-core';
import { Layer } from '@runlith/layer/Layer';
import { Service } from '@runlith/layer/key';
import { Scope } from '@runlith/layer/Scope';
import { Visitor } from '@runlith/layer/testing';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flush, waitFor } from '@runlith/testing/flush';
import { describe, expect, it, vi } from 'vitest';

import { Cache, Repo } from './repo.js';

notifyManager.setScheduler((callback) => callback());

const STATUSES = [{ id: 1, name: 'bronze' }];

type Backend = { send(path: string, options?: { method?: string; signal?: AbortSignal; body?: string }): Promise<unknown> };

class Door extends Service<Backend>()('Door', { tier: 'app' }) {}

function backend(calls: string[] = []): Backend {
  return {
    async send(path, options) {
      calls.push(`${options?.method ?? 'GET'} ${path}`);
      if (path === '/vip/statuses') return { data: STATUSES };
      return { data: { taken: true } };
    },
  };
}

async function read(door: Backend, payload: { signal?: AbortSignal }): Promise<unknown> {
  return ((await door.send('/vip/statuses', { signal: payload.signal })) as { data: unknown }).data;
}

async function write(door: Backend, payload: { signal?: AbortSignal; note?: string }): Promise<unknown> {
  const answer = await door.send('/reload/take', {
    method: 'POST',
    signal: payload.signal,
    body: JSON.stringify({ note: payload.note }),
  });
  return (answer as { data: unknown }).data;
}

const VipRepo = Repo.define(
  'shop/vip',
  ($) => ({
    statuses: $.single(async () => read),
    takeReload: $.mutation(async () => write, {
      payload: (variables: { note: string }) => ({ note: variables.note }),
    }),
  }),
  { tier: 'visitor', door: Door },
);

function mount(calls: string[] = [], door: Backend = backend(calls)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = mountApp(Layer.mergeAll(VipRepo), Layer.mergeAll(Layer.of(Door, door), Layer.of(Cache, queryClient)), {
    ladder: [Visitor],
    at: { visitor: Visitor.guest() },
  });

  return { app, queryClient };
}

function holding(sent: string[]): Backend {
  return {
    send(_path, options) {
      const { note } = JSON.parse(options?.body ?? '{}') as { note: string };
      sent.push(note);
      if (note !== 'held') return Promise.resolve({ data: { taken: note } });
      const signal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
}

describe('Repo.define', () => {
  it('builds the repository on the first ask and names each query by scope, repo and field', async () => {
    const calls: string[] = [];
    const { app, queryClient } = mount(calls);

    expect(calls).toEqual([]);

    expect(await app.get(VipRepo).statuses.load()).toEqual(STATUSES);

    expect(calls).toEqual(['GET /vip/statuses']);
    expect(queryClient.getQueryData(['visitor:guest/shop/vip.statuses'])).toEqual(STATUSES);

    await app.unmount();
  });

  it('hands the mutation its variables as the backend function s payload', async () => {
    const calls: string[] = [];
    const { app } = mount(calls);

    expect(await app.get(VipRepo).takeReload.run({ note: 'daily' })).toEqual({ taken: true });
    expect(calls).toEqual(['POST /reload/take']);

    await app.unmount();
  });

  it('two open scopes of one rung hold their own entries, a closing one drops only its own, and an app-tier repo carries no prefix', async () => {
    const PublicRepo = Repo.define('shop/public', ($) => ({ statuses: $.single(async () => read) }), {
      tier: 'app',
      door: Door,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = mountApp(Layer.mergeAll(VipRepo, PublicRepo), Layer.mergeAll(Layer.of(Door, backend()), Layer.of(Cache, queryClient)), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
    });

    await app.get(PublicRepo).statuses.load();
    await app.get(VipRepo).statuses.load();
    expect(Repo.nameOf(VipRepo, 'statuses', app.app.scopeOf('visitor'))).toBe('visitor:guest/shop/vip.statuses');

    app.place('visitor', Visitor.user('1'));
    const vip = app.get(VipRepo);
    expect(app.app.report().scopes.map((scope) => scope.name)).toEqual(['app', 'visitor:guest', 'visitor:user:1']);
    expect(queryClient.getQueryData(['visitor:guest/shop/vip.statuses'])).toEqual(STATUSES);
    expect(Repo.nameOf(VipRepo, 'statuses', app.app.scopeOf('visitor'))).toBe('visitor:user:1/shop/vip.statuses');

    await vip.statuses.load();
    await flush();
    expect(queryClient.getQueryData(['visitor:guest/shop/vip.statuses'])).toBeUndefined();
    expect(queryClient.getQueryData(['visitor:user:1/shop/vip.statuses'])).toEqual(STATUSES);
    expect(queryClient.getQueryData(['shop/public.statuses'])).toEqual(STATUSES);

    expect(Repo.nameOf(PublicRepo, 'statuses', app.app.scopeOf('visitor'))).toBe('shop/public.statuses');
    expect(queryClient.getQueryData([Repo.nameOf(PublicRepo, 'statuses', app.app.scopeOf('visitor'))])).toEqual(STATUSES);
    expect(() => Repo.nameOf(VipRepo, 'statuses', app.app.app)).toThrow(/no scope of "app" hosts the visitor-tier repo/);

    await app.unmount();
  });

  it('takes its answers out of the cache when the scope that built it closes', async () => {
    const { app, queryClient } = mount();

    await app.get(VipRepo).statuses.load();
    expect(queryClient.getQueryData(['visitor:guest/shop/vip.statuses'])).toEqual(STATUSES);

    await app.unmount();

    expect(queryClient.getQueryData(['visitor:guest/shop/vip.statuses'])).toBeUndefined();
  });
});

describe('an operation taken into a scope', () => {
  it('runs over the repo’s door, keeps only its latest run, and ends with that scope alone', async () => {
    const sent: string[] = [];
    const { app } = mount([], holding(sent));
    const repo = app.get(VipRepo);
    const frame = Scope.make('frame');
    const take = repo.takeReload.in(frame);

    const first = take.run({ note: 'held' });
    await waitFor(() => expect(sent).toEqual(['held']));
    expect(await take.run({ note: 'next' })).toEqual({ taken: 'next' });
    expect(await first).toBeUndefined();

    const flying = take.run({ note: 'held' });
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(await repo.takeReload.in(Scope.make('other')).run({ note: 'beside' })).toEqual({ taken: 'beside' });
    expect(take.pending).toBe(true);

    await frame.close();
    expect(await flying).toBeUndefined();
    expect(await take.run({ note: 'late' })).toBeUndefined();
    expect(await repo.takeReload.run({ note: 'own' })).toEqual({ taken: 'own' });
    expect(sent).toEqual(['held', 'next', 'held', 'beside', 'own']);

    await app.unmount();
  });
});

describe('Repo.tune', () => {
  it('builds the same key with the brand s numbers', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = mountApp(
      Layer.mergeAll(Repo.tune(VipRepo, { statuses: { staleTime: 5_000 } })),
      Layer.mergeAll(Layer.of(Door, backend()), Layer.of(Cache, queryClient)),
      { ladder: [Visitor], at: { visitor: Visitor.guest() } },
    );

    expect(await app.get(VipRepo).statuses.load()).toEqual(STATUSES);
    expect(queryClient.getQueryState(['visitor:guest/shop/vip.statuses'])?.data).toEqual(STATUSES);

    await app.unmount();
  });

  it('refuses a key that is not a repo', () => {
    class Plain extends Service<{ answer: number }>()('Plain', { tier: 'app' }) {
      static make() {
        return { answer: 1 };
      }
    }

    expect(() => Repo.tune(Plain as never, {})).toThrow(/Repo.tune expects a Repo.define key/);
  });
});
