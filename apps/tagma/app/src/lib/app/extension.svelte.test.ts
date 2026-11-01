// @vitest-environment jsdom
import Puzzle from '@lucide/svelte/icons/puzzle';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { SectionContributions, SettingSections } from '$lib/features/settings/section.js';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';
import SettingsPage from '$lib/features/settings/SettingsPage.svelte';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SurfaceRegistry, Surfaces } from '$lib/features/workspace/surface.js';
import { makeRouter } from '@runlith/layer/testing';
import ExtensionNote from './ExtensionNote.fixture.svelte';
import ExtensionPage from './ExtensionPage.fixture.svelte';
import ExtensionSection from './ExtensionSection.fixture.svelte';
import SurfacePage from './SurfacePage.svelte';
import { mountShell, soloWorkspace, type TestApp } from './testing.js';

const Extension = Layer.mergeAll(
  SettingSections.contribute('extension', {
    id: 'extension',
    group: 'agent',
    order: 99,
    icon: Puzzle,
    view: ExtensionSection,
    local: { title: 'Extension', description: 'Contributed from outside the core.' },
  }),
  SectionContributions.contribute(
    'extension',
    { id: 'extension-note', section: 'extension', order: 1, payload: { component: ExtensionNote } },
    { id: 'stray-note', section: 'absent', order: 1, payload: { component: ExtensionNote } },
  ),
);

const catalog = {
  projectId: 1,
  entries: [],
  sections: [],
  loading: false,
  error: null,
  entriesOf: () => [],
  setCount: () => 0,
  load: async () => undefined,
};

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a layer merged from outside the features declares a settings section and contributes into it, and the page renders both', () => {
  app = mountShell(Layer.mergeAll(SettingSections, SectionContributions, SectionRegistry, Extension), Layer.of(Workspace, soloWorkspace()));
  const page = app.draw(SettingsPage as never, {
    catalog,
    active: 'extension',
    scope: 'user',
    column: false,
    oncollapse: () => undefined,
    onvisit: () => undefined,
  });
  flushSync();

  expect(page.querySelectorAll('[data-testid="extension-section"]')).toHaveLength(1);
  expect(page.querySelectorAll('[data-testid="extension-note"]')).toHaveLength(1);
});

test('a surface merged from outside the features renders through the one contributed route, and a build without it renders nothing there', async () => {
  const at = makeRouter({ routeId: '/[project]/p/[...path]', params: { project: 'runlith', path: 'notes' } });
  const notes = Surfaces.contribute('extension', {
    surface: 'notes',
    route: 'p/notes',
    label: 'Notes',
    icon: Puzzle,
    stands: 'project',
    remembers: false,
    payload: { component: ExtensionPage },
  });

  app = mountShell(Layer.mergeAll(Surfaces, SurfaceRegistry, notes), Layer.mergeAll(), { router: at });
  const page = app.draw(SurfacePage as never, {});
  flushSync();
  expect(page.querySelector('[data-testid="extension-page"]')?.getAttribute('data-path')).toBe('notes');

  await app.unmount();
  app = mountShell(Layer.mergeAll(Surfaces, SurfaceRegistry), Layer.mergeAll(), { router: at });
  const bare = app.draw(SurfacePage as never, {});
  flushSync();
  expect(bare.textContent?.trim()).toBe('');
});
