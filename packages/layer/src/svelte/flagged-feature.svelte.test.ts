import { flush, waitFor } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownServiceError } from '../Graph.js';
import { Layer } from '../Layer.js';
import { Visitor } from '../testing.js';
import FlaggedApp from './test-utils/FlaggedApp.svelte';
import { Boot, chunkLoads, trace, Vendor, VendorLayer } from './test-utils/flagged-fixtures.svelte.js';
import { test as mountApp } from './test.svelte.js';

function makeApp(feature: boolean) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const boot = new Boot(feature);
  const app = mount(FlaggedApp, { target, props: { boot } });
  return {
    boot,
    flag: () => target.querySelector('[data-testid="flag"]')?.textContent,
    unmount: async () => {
      await unmount(app);
      target.remove();
    },
  };
}

beforeEach(() => {
  trace.length = 0;
});

describe('a feature behind a flag that arrives with boot', () => {
  it('ships nothing while the flag is off, and joins the graph when it turns on mid-session', async () => {
    const loadsBefore = chunkLoads.count;
    const app = makeApp(false);
    await flush();
    expect(trace).toEqual([]);
    expect(chunkLoads.count).toBe(loadsBefore);
    expect(app.flag()).toBe('off');

    app.boot.data = { feature: true };
    flushSync();
    await waitFor(() => expect(trace).toEqual(['start']));
    expect(app.flag()).toBe('on');

    await app.unmount();
  });

  it('turning the flag off closes what the layer built, and turning it on again reuses the chunk', async () => {
    const app = makeApp(true);
    await waitFor(() => expect(trace).toEqual(['start']));
    const loadsAfterFirst = chunkLoads.count;

    app.boot.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);

    app.boot.data = { feature: true };
    flushSync();
    await waitFor(() => expect(trace).toEqual(['start', 'stop', 'start']));
    expect(chunkLoads.count).toBe(loadsAfterFirst);

    await app.unmount();
  });

  it('unmounting stops the feature exactly once', async () => {
    const app = makeApp(true);
    await waitFor(() => expect(trace).toEqual(['start']));

    await app.unmount();
    await flush();
    expect(trace.filter((entry) => entry === 'stop')).toHaveLength(1);
  });
});

describe('the flag at the graph door', () => {
  it('a disabled feature is not in the manifest: its key answers "unknown", and enabling puts it back', async () => {
    const boot = new Boot(false);
    const rt = mountApp(Layer.mergeAll(Layer.when(() => boot.data.feature, Layer.mergeAll(Vendor))), Layer.of(Boot, boot), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
    });

    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);

    boot.data = { feature: true };
    flushSync();
    await flush();
    expect(rt.get(Vendor).report()).toBe('reported');

    boot.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);

    await rt.unmount();
  });

  it('a flag that flips while the chunk is in flight ends on the last word', async () => {
    const boot = new Boot(false);
    let loads = 0;
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          () => boot.data.feature,
          () => {
            loads += 1;
            return Promise.resolve({ default: Layer.mergeAll(Vendor) });
          },
        ),
      ),
      Layer.of(Boot, boot),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    boot.data = { feature: true };
    flushSync();
    boot.data = { feature: false };
    flushSync();
    await flush();

    expect(loads).toBe(1);
    expect(trace).toEqual([]);
    await rt.unmount();
  });

  it('a flag that turns on, off and on again while the chunk flies admits the layer once, and the next off takes it back', async () => {
    const boot = new Boot(false);
    let loads = 0;
    let land: () => void = () => undefined;
    const chunk = new Promise<{ default: typeof VendorLayer }>((resolve) => {
      land = () => resolve({ default: VendorLayer });
    });
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          () => boot.data.feature,
          () => {
            loads += 1;
            return chunk;
          },
        ),
      ),
      Layer.of(Boot, boot),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    for (const feature of [true, false, true]) {
      boot.data = { feature };
      flushSync();
    }
    land();
    await flush();
    expect(loads).toBe(1);
    expect(trace).toEqual(['start']);

    boot.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);
    await rt.unmount();
  });

  it('a key two conditions admit stays while either holds it, and leaves with the last', async () => {
    const first = new Boot(true);
    const second = new Boot(true);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(() => first.data.feature, VendorLayer),
        Layer.when(() => second.data.feature, VendorLayer),
      ),
      Layer.of(Boot, first),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();
    expect(trace).toEqual(['start']);

    first.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start']);
    expect(rt.get(Vendor).report()).toBe('reported');

    second.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);
    await rt.unmount();
  });

  it('a condition reads its service through the graph, and stays reactive through it', async () => {
    const boot = new Boot(false);
    const rt = mountApp(Layer.mergeAll(Layer.when(Boot, (boot) => boot.data.feature, Layer.mergeAll(Vendor))), Layer.of(Boot, boot), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
    });

    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);

    boot.data = { feature: true };
    flushSync();
    await flush();
    expect(rt.get(Vendor).report()).toBe('reported');

    boot.data = { feature: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);

    await rt.unmount();
  });

  it('a condition that reads nothing reactive keeps its one-time behaviour', async () => {
    const rt = mountApp(Layer.mergeAll(Layer.when(() => false, Layer.mergeAll(Vendor))), Layer.mergeAll(), {
      ladder: [Visitor],
      at: { visitor: Visitor.guest() },
      data: 'lazy',
    });

    await flush();
    expect(trace).toEqual([]);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);
    await rt.unmount();
  });
});
