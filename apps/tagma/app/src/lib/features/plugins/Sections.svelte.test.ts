// @vitest-environment jsdom
import type { PluginViewSet, PluginViewState } from '@tagma/server/views/contract/wire/sets';
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp, testSurfaces } from '$lib/app/testing.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { Live } from '$lib/wire/Live.js';
import { PluginActions } from './PluginActions.svelte.js';
import { Sections } from './Sections.svelte.js';
import { sectionActions, sectionDeclarations } from './sections.js';
import { PLUGIN_SURFACE } from './surfaces.js';
import { ViewSets } from './ViewSets.svelte.js';

const board = (projectId: number): PluginViewSet => ({
  plugin: 'board',
  title: 'Board',
  site: { _tag: 'unserved', reason: 'test' },
  views: [{ id: 'main', entry: 'ui/main.html' }],
  results: [],
  surfaces: [{ view: 'main', title: `Board of ${projectId}` }],
  panes: [],
  launchers: [],
});

const railOf = (surfaces: SurfaceRegistry): string[] =>
  surfaces.rail.filter((entry) => entry.surface.startsWith(`${PLUGIN_SURFACE}/`)).map((entry) => entry.label);

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function stand() {
  const live = {
    hold: (open: (client: unknown) => unknown, frame: (state: PluginViewState) => void) => {
      const { projectId } = open(new Proxy({}, { get: () => (payload: unknown) => payload })) as { projectId: number };
      queueMicrotask(() => frame({ plugins: [board(projectId)], enabled: ['board'] }));
      return { unsubscribe: () => undefined };
    },
  };
  const mounted = mountShell(Layer.mergeAll(Sections, ViewSets, PluginActions, ProjectFocus), Layer.of(Live, live as never), {
    at: { projectId: 1, branch: null },
  });
  app = mounted;
  return {
    app: mounted.app,
    go: async (projectId: number): Promise<void> => {
      mounted.place({ projectId, branch: null });
      await flush();
    },
    actions: () => mounted.app.resolve(PluginActions).actions.map((action) => action.title),
    rail: () => railOf(mounted.app.resolve(SurfaceRegistry)),
  };
}

test('two warm projects with one plugin hand the window its sections in turn: only the current one stands in the rail and the palette', async () => {
  const world = stand();
  await flush();
  const first = world.app.hold(ProjectRung, { projectId: 1 });

  await world.go(2);
  expect(world.rail()).toEqual(['Board of 2']);
  expect(world.actions()).toEqual(['Go to Board of 2']);
  const second = world.app.hold(ProjectRung, { projectId: 2 });

  await world.go(1);
  expect(world.rail()).toEqual(['Board of 1']);
  expect(world.actions()).toEqual(['Go to Board of 1']);

  await world.go(2);
  expect(world.rail()).toEqual(['Board of 2']);
  expect(world.actions()).toEqual(['Go to Board of 2']);

  first.release();
  second.release();
});

test('a publication another one replaced is gone, and releasing it late leaves the window to the one standing', () => {
  const surfaces = testSurfaces();
  const actions = new PluginActions(surfaces);
  const shown = (projectId: number) => actions.show(sectionDeclarations([board(projectId)]), sectionActions([board(projectId)]));
  const stale = shown(1);
  shown(2);

  stale();
  expect(railOf(surfaces)).toEqual(['Board of 2']);
  expect(actions.actions.map((action) => action.title)).toEqual(['Go to Board of 2']);

  const last = shown(3);
  expect(railOf(surfaces)).toEqual(['Board of 3']);
  last();
});
