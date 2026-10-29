import { flush, waitFor } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { Visitor, type VisitorInput } from '../testing.js';
import DeferredApp from './test-utils/DeferredApp.svelte';
import { probe } from './test-utils/deferred-fixtures.js';

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
    await waitFor(() => expect(app.found()).toHaveLength(2));
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
    await waitFor(() => expect(app.found()).toHaveLength(1));
    expect(app.found()[0]).toMatch(/^hit:book#\d+$/);
    await app.unmount();
  });

  it('a session recycle drops the instance but never refetches the chunk', async () => {
    const app = makeApp({ open: true, session: Visitor.user('1') });
    await waitFor(() => expect(app.found()).toHaveLength(1));
    const first = app.found()[0];
    const loadsAfterFirst = probe.loaded;

    app.state.open = false;
    app.state.session = Visitor.user('2');
    flushSync();
    await flush();

    app.state.open = true;
    flushSync();
    await waitFor(() => expect(app.found()).toHaveLength(1));
    expect(app.found()[0]).not.toBe(first);
    expect(probe.loaded).toBe(loadsAfterFirst);
    await app.unmount();
  });
});
