import { flush, waitFor } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { UnknownServiceError } from '../Graph.js';
import { Layer } from '../Layer.js';
import { Prepare } from '../Prepare.js';
import { Visitor } from '../testing.js';
import { trace, Vendor } from './test-utils/flagged-fixtures.svelte.js';
import { Gate, UserVendor } from './test-utils/nested-fixtures.svelte.js';
import { test as mountApp } from './test.svelte.js';

beforeEach(() => {
  trace.length = 0;
});

describe('a condition that arrives inside a chunk', () => {
  it('is read in the scope the chunk landed in, and its layer joins when it holds', async () => {
    const gate = new Gate(true);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          () => true,
          () => import('./test-utils/nested-chunk.js'),
        ),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    await waitFor(() => expect(trace).toEqual(['start']));
    expect(rt.get(Vendor).report()).toBe('reported');
    await rt.unmount();
  });

  it('stays watched after the chunk landed: the gate opening later admits the layer, closing it takes the layer back', async () => {
    const gate = new Gate(false);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          () => true,
          () => import('./test-utils/nested-chunk.js'),
        ),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    await rt.app.ready;
    await flush();
    expect(trace).toEqual([]);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);

    gate.data = { open: true };
    flushSync();
    await flush();
    expect(trace).toEqual(['start']);

    gate.data = { open: false };
    flushSync();
    await flush();
    expect(trace).toEqual(['start', 'stop']);
    expect(() => rt.get(Vendor)).toThrow(UnknownServiceError);
    await rt.unmount();
  });

  it('is read in a rung scope already open under the scope that fetched the chunk', async () => {
    const gate = new Gate(true);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          () => true,
          () => import('./test-utils/nested-chunk.js'),
        ),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.user('1') }, data: 'lazy' },
    );

    await waitFor(() => expect(trace).toEqual(expect.arrayContaining(['start', 'user-start'])));
    expect(rt.get(UserVendor)).toBeInstanceOf(UserVendor);
    await rt.unmount();
  });
});

describe('a rung scope prepared before it opens', () => {
  it('has its chunk in memory, so the chunk layer is included in the tick the scope starts', async () => {
    let loads = 0;
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(Visitor.present('user'), () => {
          loads += 1;
          return import('./test-utils/session-chunk.js');
        }),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();

    await rt.get(Prepare)(Visitor, Visitor.user('1'));
    expect(loads).toBe(1);
    expect(trace).toEqual([]);

    rt.place('visitor', Visitor.user('1'));
    flushSync();
    expect(trace).toEqual(['user-start']);
    expect(rt.get(UserVendor)).toBeInstanceOf(UserVendor);
    await rt.unmount();
  });

  it('fetches only what the kind hosts: preparing a guest leaves the user chunk alone', async () => {
    let loads = 0;
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(Visitor.present('user'), () => {
          loads += 1;
          return import('./test-utils/session-chunk.js');
        }),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );
    await flush();

    await rt.get(Prepare)(Visitor, Visitor.guest());
    expect(loads).toBe(0);
    await rt.unmount();
  });

  it('a chunk that failed to load is asked for again by the next scope that admits it', async () => {
    let attempts = 0;
    const gate = new Gate(false);
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(
          Gate,
          (open) => open.data.open,
          () => {
            attempts += 1;
            return attempts === 1 ? Promise.reject(new Error('refused')) : Promise.resolve({ default: Layer.mergeAll(Vendor) });
          },
        ),
      ),
      Layer.of(Gate, gate),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy', onFailure: () => undefined },
    );

    gate.data = { open: true };
    flushSync();
    await flush();
    expect(attempts).toBe(1);
    expect(trace).toEqual([]);

    gate.data = { open: false };
    flushSync();
    gate.data = { open: true };
    flushSync();
    await flush();
    expect(attempts).toBe(2);
    expect(trace).toEqual(['start']);
    await rt.unmount();
  });
});

describe('a layer behind Visitor.present("user")', () => {
  it('is never fetched for a guest, arrives with the signed-in visitor, and leaves with it', async () => {
    let loads = 0;
    const rt = mountApp(
      Layer.mergeAll(
        Layer.when(Visitor.present('user'), () => {
          loads += 1;
          return import('./test-utils/session-chunk.js');
        }),
      ),
      Layer.mergeAll(),
      { ladder: [Visitor], at: { visitor: Visitor.guest() }, data: 'lazy' },
    );

    await flush();
    expect(loads).toBe(0);
    expect(trace).toEqual([]);

    rt.place('visitor', Visitor.user('1'));
    flushSync();
    await waitFor(() => expect(trace).toEqual(['user-start']));
    expect(loads).toBe(1);
    expect(rt.get(UserVendor)).toBeInstanceOf(UserVendor);

    rt.place('visitor', Visitor.guest());
    flushSync();
    await flush();
    expect(trace).toEqual(['user-start', 'user-stop']);
    await rt.unmount();
  });
});
