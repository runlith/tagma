import { reactiveCell } from '@runlith/roster/cell.svelte';
import { RegistryClash } from '@runlith/roster/RegistryClash';
import { Roster } from '@runlith/roster/Roster';
import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { ServiceStartError } from '../Graph.js';
import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Point } from '../Point.js';
import type { Shown } from './payload.js';
import { test as mountApp } from './test.svelte.js';
import Broken from './test-utils/point/Broken.svelte';
import Labelled from './test-utils/point/Labelled.svelte';
import PanelsHost from './test-utils/point/PanelsHost.svelte';

type Entry = { readonly id: string; readonly order: number };

const Menu = Point.define<Entry>()('PointTest.Menu', { tier: 'app', key: (entry) => entry.id, order: (entry) => entry.order });

class Gate extends Service<Gate>()('PointTest.Gate', { tier: 'app' }) {
  on = $state(false);
}

describe('Point', () => {
  it('lists what feature layers contribute by order, an item under a condition with it, and a run-time source until it leaves', async () => {
    const gate = new Gate();
    const rt = mountApp(
      Layer.mergeAll(
        Menu,
        Menu.contribute('late', { id: 'late', order: 2 }),
        Menu.contribute('first', { id: 'first', order: 1 }),
        Layer.when(Gate, (open) => open.on, Menu.contribute('flagged', { id: 'flagged', order: 1.5 })),
      ),
      Layer.of(Gate, gate),
    );
    const menu = rt.get(Menu);
    const ids = () => menu.items.map((entry) => entry.id);
    await flush();
    expect(ids()).toEqual(['first', 'late']);

    gate.on = true;
    flushSync();
    await flush();
    expect(ids()).toEqual(['first', 'flagged', 'late']);

    gate.on = false;
    flushSync();
    await flush();
    expect(ids()).toEqual(['first', 'late']);

    const leave = menu.register('views', { id: 'view', order: 0 });
    expect(menu.find('view')?.order).toBe(0);
    leave();
    expect(menu.find('view')).toBeUndefined();
    await rt.unmount();
  });

  it('refuses a second contributor of one item key naming both, and keeps the first', async () => {
    const failures: unknown[] = [];
    const rt = mountApp(
      Layer.mergeAll(Menu, Menu.contribute('features/a', { id: 'x', order: 0 }), Menu.contribute('features/b', { id: 'x', order: 1 })),
      Layer.mergeAll(),
      { onFailure: (error) => failures.push(error) },
    );
    await flush();

    expect(failures).toHaveLength(1);
    const clash = (failures[0] as ServiceStartError).cause;
    expect(clash).toBeInstanceOf(RegistryClash);
    expect((clash as RegistryClash).holders).toEqual(['features/a', 'features/b']);
    expect(rt.get(Menu).items).toEqual([{ id: 'x', order: 0 }]);
    await rt.unmount();
  });
});

type Panel = Shown<{ label: string }, string> & { readonly id: string };

describe('PointView', () => {
  it('renders nothing for an empty point, then each item under its own boundary: a component, a view by the owner’s renderer, a failure contained', () => {
    const point = new Point<Panel>(
      'PointTest.Panels',
      (panel) => panel.id,
      new Roster<Panel>(
        (key) => key,
        (panel) => panel.id,
        reactiveCell(),
      ),
    );
    const target = document.createElement('div');
    document.body.appendChild(target);
    const host = mount(PanelsHost, { target, props: { point } });
    flushSync();
    expect(target.innerHTML.replace(/<!---->/g, '')).toBe('');

    point.register('core', { id: 'plain', payload: { component: Labelled } }, { id: 'broken', payload: { component: Broken } });
    const leave = point.register('apps', { id: 'app', payload: { view: 'board/main' } });
    flushSync();

    expect(target.querySelectorAll('[data-frame]')).toHaveLength(1);
    expect(target.querySelector('[data-item]')?.textContent).toBe('owner');
    expect(target.querySelector('[data-view]')?.textContent).toBe('board/main for owner');
    expect(target.querySelectorAll('[data-testid="error-boundary-fallback"]')).toHaveLength(1);

    leave();
    flushSync();
    expect(target.querySelector('[data-view]')).toBeNull();
    void unmount(host);
    target.remove();
  });
});
