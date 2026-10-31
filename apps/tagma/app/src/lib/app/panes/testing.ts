import type { PlatformStorage } from '@runlith/layer/Platform';
import type { Resolver } from '@runlith/layer/key';
import { makePoint, makeStorage } from '@runlith/layer/testing';
import { SurfaceRegistry, Surfaces } from '$lib/features/workspace/surface.js';
import { type PaneKind, Panes } from '$lib/shared/panes/pane.js';
import { PaneRegistry } from './PaneRegistry.js';
import { SidePanes } from './SidePanes.svelte.js';
import { TabLayouts } from './TabLayouts.svelte.js';

export const testKind = (name: string): PaneKind => ({
  kind: name,
  noun: name,
  view: () => Promise.reject(new Error('A test tab is never drawn.')),
  title: (() => undefined) as unknown as PaneKind['title'],
});

export const testPanes = (...kinds: readonly PaneKind[]): PaneRegistry => new PaneRegistry(makePoint(Panes, ...kinds));

export const noSurfaces = (): SurfaceRegistry => new SurfaceRegistry(makePoint(Surfaces));

export type TestArea = { readonly panes: SidePanes; readonly layouts: TabLayouts };

const NO_APP: Resolver = {
  resolve: () => {
    throw new Error('A test area resolves no service.');
  },
};

export function testArea(kinds: readonly PaneKind[], storage: PlatformStorage = makeStorage(), app: Resolver = NO_APP): TestArea {
  const registry = testPanes(...kinds);
  const panes = new SidePanes(registry);
  const layouts = new TabLayouts(1, storage, registry, noSurfaces(), () => 1);
  panes.attach(layouts, app);
  panes.showSection('test');
  return { panes, layouts };
}
