// @vitest-environment jsdom
import type { PluginActionSet } from '@tagma/server/views/contract/wire/actions';
import type { PluginViewSet, PluginViewState } from '@tagma/server/views/contract/wire/sets';
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { makePoint } from '@runlith/layer/testing';
import { mountShell, soloWorkspace, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { type ActionEnv, Actions } from '$lib/features/workspace/action.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { SurfaceRegistry, Surfaces } from '$lib/features/workspace/surface.js';
import { Live } from '$lib/wire/Live.js';
import { Sections } from './Sections.svelte.js';
import { sectionDeclarations } from './sections.js';
import { PluginActions } from './PluginActions.svelte.js';
import { PluginModules } from './PluginModules.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { sectionSurface } from './surfaces.js';
import { ViewSets } from './ViewSets.svelte.js';
import { ShellOps } from '$lib/features/workspace/ShellOps.js';
import { Effect } from 'effect';

const board = (projectId: number): PluginViewSet => ({
  plugin: 'board',
  title: 'Board',
  views: [{ id: 'main', module: { state: 'preparing' } }],
  results: [],
  surfaces: [{ view: 'main', title: `Board of ${projectId}`, icon: null }],
  panes: [],
  launchers: [],
});

const railOf = (surfaces: SurfaceRegistry): string[] =>
  surfaces.rail.filter((entry) => entry.surface.startsWith('plugin-section/')).map((entry) => entry.label);

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function stand(served: { readonly actions?: readonly PluginActionSet[]; readonly workspace?: Workspace } = {}) {
  const live = {
    hold: (open: (client: unknown) => unknown, frame: (state: unknown) => void) => {
      const asked = open(new Proxy({}, { get: (_, feed) => (payload: object) => ({ feed, ...payload }) })) as {
        feed: string;
        projectId?: number;
      };
      queueMicrotask(() =>
        frame(
          asked.feed === 'views.actions'
            ? { plugins: served.actions ?? [] }
            : asked.projectId === undefined
              ? { plugins: [] }
              : ({ plugins: [board(asked.projectId)], enabled: ['board'], sheet: null } satisfies PluginViewState),
        ),
      );
      return { unsubscribe: () => undefined };
    },
  };
  const boot = Layer.mergeAll(Layer.of(Live, live as never), Layer.of(Workspace, served.workspace ?? soloWorkspace()));
  const mounted = mountShell(Layer.mergeAll(Sections, ViewSets, PluginModules, PluginActions, Actions, ProjectFocus, Keymap), boot, {
    at: { projectId: 1, branch: null },
  });
  app = mounted;
  return {
    app: mounted.app,
    go: async (projectId: number): Promise<void> => {
      mounted.place({ projectId, branch: null });
      await flush();
    },
    rail: () => railOf(mounted.app.resolve(SurfaceRegistry)),
  };
}

test('two warm projects with one plugin hand the window its sections in turn: only the current one stands in the rail', async () => {
  const world = stand();
  await flush();
  const first = world.app.hold(ProjectRung, { projectId: 1 });

  await world.go(2);
  expect(world.rail()).toEqual(['Board of 2']);
  const second = world.app.hold(ProjectRung, { projectId: 2 });

  await world.go(1);
  expect(world.rail()).toEqual(['Board of 1']);

  await world.go(2);
  expect(world.rail()).toEqual(['Board of 2']);

  first.release();
  second.release();
});

test('a publication another one replaced is gone, and releasing it late leaves the window to the one standing', () => {
  const point = makePoint(Surfaces);
  const surfaces = new SurfaceRegistry(point);
  const publisher = new PluginActions(point, makePoint(Actions), soloWorkspace());
  const shown = (projectId: number) => publisher.show(sectionDeclarations([board(projectId)]));
  const stale = shown(1);
  shown(2);

  stale();
  expect(railOf(surfaces)).toEqual(['Board of 2']);

  const last = shown(3);
  expect(railOf(surfaces)).toEqual(['Board of 3']);
  last();
});

test("a plugin section's act opens the section in the context project when it enables the plugin, and otherwise in the first project of the person's list that does", async () => {
  const set: PluginActionSet = {
    plugin: 'mrs',
    title: 'Merge requests',
    rank: 0,
    projects: [3, 2],
    actions: [{ id: 'section:list', kind: 'section', view: 'list', title: 'Merge requests', keys: [{ keys: 'Mod+Alt+G', global: false }] }],
    commands: [],
  };
  const projects = [1, 2, 3].map((id) => ({ id, name: `p${id}`, kind: 'folder' }));
  const world = stand({ actions: [set], workspace: soloWorkspace({ projects }) });
  await flush();
  const action = world.app
    .resolve(Actions)
    .items.flatMap(({ actions }) => (typeof actions === 'function' ? actions() : actions))
    .find((one) => one.id === 'plugin.mrs.section:list');
  const went: unknown[] = [];
  const ops = {
    openProject: (projectId: number) => Effect.sync(() => void went.push(projectId)),
    revealSurface: (surface: string) => Effect.sync(() => void went.push(surface)),
  };
  const env = (project: number): ActionEnv => ({
    project: projects[project - 1] as never,
    routeProject: null,
    surface: null,
    goto: () => undefined,
    resolve: ((key: unknown) => (key === ShellOps ? ops : {})) as never,
  });
  expect(action?.title).toBe('Go to Merge requests');
  expect(action?.listed?.(env(1))).toBe(false);
  await action?.run?.(env(1));
  expect(went).toEqual([2, sectionSurface('mrs', 'list')]);
  went.length = 0;
  await action?.run?.(env(3));
  expect(went).toEqual([sectionSurface('mrs', 'list')]);
});
