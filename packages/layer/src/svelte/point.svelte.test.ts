import { reactiveCell } from '@runlith/roster/cell.svelte';
import { Roster } from '@runlith/roster/Roster';
import { flush } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import { KeyIdCollisionError, ServiceStartError } from '../Graph.js';
import { Service } from '../key.js';
import { Layer } from '../Layer.js';
import { Point } from '../Point.js';
import type { Shown } from './payload.js';
import { test as mountApp } from './test.svelte.js';
import Broken from './test-utils/point/Broken.svelte';
import ComponentsHost from './test-utils/point/ComponentsHost.svelte';
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
    expect(clash).toMatchObject({ name: 'RegistryClash', holders: ['features/a', 'features/b'] });
    expect(rt.get(Menu).items).toEqual([{ id: 'x', order: 0 }]);
    await rt.unmount();
  });

  it('refuses two contributions under one name even when one condition admits both', () => {
    expect(() =>
      mountApp(
        Layer.mergeAll(
          Menu,
          Layer.when(
            () => true,
            Layer.mergeAll(Menu.contribute('same', { id: 'a', order: 0 }), Menu.contribute('same', { id: 'b', order: 1 })),
          ),
        ),
        Layer.mergeAll(),
      ),
    ).toThrow(KeyIdCollisionError);
  });
});

function pointOf<Item extends { readonly id: string }>(): Point<Item> {
  return new Point<Item>(
    'PointTest.Panels',
    (item) => item.id,
    new Roster<Item>(
      (key) => key,
      (item) => item.id,
      reactiveCell(),
    ),
  );
}

function show(render: (target: HTMLElement) => object) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const mounted = render(target);
  return {
    target,
    remove: () => {
      void unmount(mounted);
      target.remove();
    },
  };
}

describe('PointView', () => {
  it('renders nothing for an empty point, then each item under its own boundary: a component, a view by the owner’s renderer, a failure contained', () => {
    const components = pointOf<Shown<{ label: string }> & { readonly id: string }>();
    const shown = show((target) => mount(ComponentsHost, { target, props: { point: components } }));
    flushSync();
    expect(shown.target.innerHTML.replace(/<!---->/g, '')).toBe('');

    components.register('core', { id: 'plain', payload: { component: Labelled } }, { id: 'broken', payload: { component: Broken } });
    flushSync();
    expect(shown.target.querySelector('[data-item]')?.textContent).toBe('owner');
    expect(shown.target.querySelectorAll('[data-testid="error-boundary-fallback"]')).toHaveLength(1);
    shown.remove();

    const views = pointOf<Shown<{ label: string }, string> & { readonly id: string }>();
    const framed = show((target) => mount(PanelsHost, { target, props: { point: views } }));
    const leave = views.register('apps', { id: 'app', payload: { view: 'board/main' } });
    flushSync();
    expect(framed.target.querySelectorAll('[data-frame]')).toHaveLength(1);
    expect(framed.target.querySelector('[data-view]')?.textContent).toBe('board/main for owner');

    leave();
    flushSync();
    expect(framed.target.querySelector('[data-frame]')).toBeNull();
    framed.remove();
  });
});
