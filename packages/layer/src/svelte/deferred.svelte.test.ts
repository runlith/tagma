import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { DeferredServiceError, MissingRecipeError } from '../Graph.js';
import { Service, type KeyClass } from '../key.js';
import { Layer } from '../Layer.js';
import { Visitor, type VisitorInput } from '../testing.js';
import DeferredApp from './test-utils/DeferredApp.svelte';
import { Config, probe, Search, SearchLive, type SearchPort } from './test-utils/deferred-fixtures.js';
import { test as mountApp } from './test.svelte.js';

function makeApp(props: { open: boolean; twin?: boolean; session: VisitorInput }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const state = $state(props);
  const app = mount(DeferredApp, { target, props: state });
  return {
    target,
    state,
    found: () => [...target.querySelectorAll('[data-testid="found"]')].map((node) => node.textContent),
    unmount: async () => {
      await unmount(app);
      target.remove();
    },
  };
}

describe('deferred service in a real component tree', () => {
  it('ships no code while the surface is closed, and one chunk builds one instance for two consumers', async () => {
    const loadedBefore = probe.loaded;
    const builtBefore = probe.built;
    const app = makeApp({ open: false, twin: true, session: Visitor.user('1') });
    await flush();
    expect(probe.loaded).toBe(loadedBefore);
    expect(app.found()).toEqual([]);

    app.state.open = true;
    flushSync();
    await expect.poll(() => app.found()).toHaveLength(2);
    const [one, two] = app.found();
    expect(one).toMatch(/^hit:book#\d+$/);
    expect(one).toBe(two);
    expect(probe.loaded).toBe(1);
    expect(probe.built - builtBefore).toBe(1);
    await app.unmount();
  });

  it('shows the boundary pending snippet while the chunk is in flight', async () => {
    const app = makeApp({ open: true, session: Visitor.user('1') });
    flushSync();
    expect(app.target.querySelector('[data-testid="pending"]')).not.toBeNull();
    await expect.poll(() => app.found()).toHaveLength(1);
    expect(app.found()[0]).toMatch(/^hit:book#\d+$/);
    await app.unmount();
  });

  it('a session recycle drops the instance but never refetches the chunk', async () => {
    const app = makeApp({ open: true, session: Visitor.user('1') });
    await expect.poll(() => app.found()).toHaveLength(1);
    const first = app.found()[0];
    const loadsAfterFirst = probe.loaded;

    app.state.open = false;
    app.state.session = Visitor.user('2');
    flushSync();
    await flush();

    app.state.open = true;
    flushSync();
    await expect.poll(() => app.found()).toHaveLength(1);
    expect(app.found()[0]).not.toBe(first);
    expect(probe.loaded).toBe(loadsAfterFirst);
    await app.unmount();
  });
});

describe('deferred service at the graph door', () => {
  it('the instance door stays closed: resolve throws, and use() answers a handle, never the instance', async () => {
    const rt = mountApp(Layer.mergeAll(SearchLive), Layer.of(Config, new Config('hit')), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
    });
    expect(() => rt.get(Search as unknown as KeyClass<string, SearchPort>)).toThrow(DeferredServiceError);
    await rt.unmount();

    expect(() => {
      // @ts-expect-error a deferred key answers a handle: the instance is behind `await` or `.current`
      const sync: SearchPort = Search.use();
      return sync;
    }).toThrow();
  });

  it('a deferred key enters a manifest with its chunk, and what the chunk requires is the manifest’s to close', () => {
    const unclosed = () =>
      // @ts-expect-error the chunk behind Search builds its engine from Config, and nothing here provides it
      mountApp(Layer.mergeAll(SearchLive), Layer.mergeAll(), { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' });
    expect(unclosed).toBeTypeOf('function');

    // @ts-expect-error a deferred key has no recipe of its own
    const bare = Layer.mergeAll(Search);
    expect(() => mountApp(bare, Layer.of(Config, new Config('hit')), { ladder: [Visitor], at: { visitor: Visitor.user('1') } })).toThrow(
      MissingRecipeError,
    );
  });

  it('yield* answers a handle: empty until the chunk lands, then the one instance use() builds', async () => {
    const rt = mountApp(Layer.mergeAll(SearchLive), Layer.of(Config, new Config('hit')), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
    });
    const handle = rt.app.run(
      (function* () {
        return yield* Search;
      })(),
    );
    expect(handle.current).toBeUndefined();

    const built = await handle.ready;
    expect(handle.current).toBe(built);
    expect(await handle).toBe(built);
    expect(built.find('book')).toMatch(/^hit:book#\d+$/);
    expect(await rt.app.resolveDeferred(Search)).toBe(built);
    expect(
      rt.app.run(
        (function* () {
          return yield* Search;
        })(),
      ),
    ).toBe(handle);
    await rt.unmount();
  });

  it('a deferred key provided synchronously hands a handle that is full from the start', async () => {
    const engine: SearchPort = { find: (query) => `stub:${query}` };
    const rt = mountApp(Layer.mergeAll(), Layer.mergeAll(Layer.of(Search, engine), Layer.of(Config, new Config('hit'))), {
      ladder: [Visitor],
      at: { visitor: Visitor.user('1') },
      data: 'lazy',
    });
    const handle = rt.app.run(
      (function* () {
        return yield* Search;
      })(),
    );
    expect(handle.current).toBe(engine);
    expect(await handle.ready).toBe(engine);
    await rt.unmount();
  });

  it('two concurrent awaits share one build, and a failed fetch is retried rather than cached', async () => {
    class Flaky extends Service<{ ping(): string }>()('Flaky', { tier: 'app', deferred: true }) {}
    let attempts = 0;
    const chunk = () => ({ default: Layer.provide(Flaky, () => ({ ping: () => `pong#${attempts}` })) });
    const rt = mountApp(
      Layer.mergeAll(
        Layer.load(Flaky, () => {
          attempts += 1;
          return attempts === 1 ? Promise.reject(new Error('chunk 404')) : Promise.resolve(chunk());
        }),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    await expect(rt.app.resolveDeferred(Flaky)).rejects.toThrow('chunk 404');

    const [first, second] = await Promise.all([rt.app.resolveDeferred(Flaky), rt.app.resolveDeferred(Flaky)]);
    expect(first).toBe(second);
    expect(first.ping()).toBe('pong#2');
    expect(attempts).toBe(2);
    await rt.unmount();
  });
});
