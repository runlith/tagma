import type { PlatformStorage } from '@runlith/layer/Platform';
import type { Resolver } from '@runlith/layer/key';
import { makeStorage } from '@runlith/layer/testing';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import type { PaneKind } from '$lib/shared/panes/pane.js';
import { PaneRegistry } from './PaneRegistry.js';
import { SidePanes } from './SidePanes.svelte.js';
import { TabLayouts } from './TabLayouts.svelte.js';

export const testKind = (name: string): PaneKind => ({
  kind: name,
  noun: name,
  view: () => Promise.reject(new Error('A test tab is never drawn.')),
  title: (() => undefined) as unknown as PaneKind['title'],
});

export type TestArea = { readonly panes: SidePanes; readonly layouts: TabLayouts };

const NO_APP: Resolver = {
  resolve: () => {
    throw new Error('A test area resolves no service.');
  },
};

export function testArea(kinds: readonly PaneKind[], storage: PlatformStorage = makeStorage(), app: Resolver = NO_APP): TestArea {
  const registry = new PaneRegistry(kinds);
  const panes = new SidePanes(registry);
  const layouts = new TabLayouts(1, storage, registry, new SurfaceRegistry([]), () => 1);
  panes.attach(layouts, app);
  panes.showSection('test');
  return { panes, layouts };
}
