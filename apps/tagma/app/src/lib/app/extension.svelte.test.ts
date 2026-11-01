// @vitest-environment jsdom
import Puzzle from '@lucide/svelte/icons/puzzle';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { SectionContributions, SettingSections } from '@tagma/app/points/settings';
import { SurfaceRegistry, Surfaces } from '@tagma/app/points/surfaces';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';
import SettingsPage from '$lib/features/settings/SettingsPage.svelte';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { makePoint, makeRouter, makeRouterWithLog } from '@runlith/layer/testing';
import type { Resolver } from '@runlith/layer/key';
import { TopBarParts, WindowParts } from '@tagma/app/points/parts';
import { StagedKinds } from '@tagma/app/points/staged';
import { Access } from '@tagma/app/wire/access';
import { ThreadDraft } from '$lib/features/threads/Draft.svelte.js';
import StagedCards from '$lib/features/threads/native/StagedCards.svelte';
import { StagedItems } from '$lib/features/threads/native/StagedItems.js';
import { testShelf } from '$lib/features/threads/native/testing.js';
import type { ThreadUploads } from '$lib/features/threads/native/ThreadUploads.js';
import ExtensionCard from './ExtensionCard.fixture.svelte';
import ExtensionNote from './ExtensionNote.fixture.svelte';
import ExtensionPart from './ExtensionPart.fixture.svelte';
import FormerRoutes from './FormerRoutes.svelte';
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

test('a top-bar or window part merged from outside draws whatever the right answers when ungated, and its offer when a gated right answers none', () => {
  const part = { id: 'part', order: 1, payload: { component: ExtensionPart } };
  const gated = { id: 'gated', order: 2, right: 'extension', payload: { component: ExtensionPart }, offer: { component: ExtensionPart } };
  const none = { key: 'extension', state: 'unpaid', access: 'none' as const, unblock: [] };
  app = mountShell(
    Layer.mergeAll(TopBarParts, WindowParts, TopBarParts.contribute('extension', part, gated), WindowParts.contribute('extension', part)),
    Layer.of(Access, { right: (key) => (key === none.key ? none : undefined) }),
  );
  const top = app.get(TopBarParts);
  const parts = app.get(WindowParts);

  expect(top.items.map((item) => top.drawn(item)?.id)).toEqual(['part', 'gated']);
  expect(top.drawn(part)?.payload).toBe(part.payload);
  expect(top.drawn(gated)?.payload).toBe(gated.offer);
  expect(parts.items.map((item) => parts.drawn(item)?.payload)).toEqual([part.payload]);
});

test('a draft item of a kind merged from outside is drawn by its kind’s card, and one of a kind the build lacks is not drawn', () => {
  const kind = { kind: 'extension', card: ExtensionCard, file: async () => null };
  app = mountShell(Layer.mergeAll(StagedKinds, StagedKinds.contribute('extension', kind)));
  const draft = new ThreadDraft(testShelf(), {} as ThreadUploads, new StagedItems(makePoint(StagedKinds, kind), {} as Resolver, 1));
  draft.useKey('new:extension');
  draft.stage({ kind: 'extension', key: 'a', title: 'Extension item', data: null });
  draft.stage({ kind: 'absent', key: 'b', title: 'Absent item', data: null });
  const drawn = app.draw(StagedCards as never, { draft });
  flushSync();

  expect([...drawn.querySelectorAll('[data-testid="extension-card"]')].map((card) => card.textContent)).toEqual(['Extension item']);
});

test('an address under a surface’s former route moves to its p address with its path and query, and a route file that still answers keeps it', async () => {
  const notes = Surfaces.contribute('extension', {
    surface: 'notes',
    route: 'p/notes',
    formerRoutes: ['memos'],
    label: 'Notes',
    icon: Puzzle,
    stands: 'project',
    remembers: false,
    payload: { component: ExtensionPage },
  });
  const url = new URL('http://localhost/runlith/memos/42?at=5');
  const stray = makeRouterWithLog({ url, routeId: undefined });
  app = mountShell(Layer.mergeAll(Surfaces, SurfaceRegistry, notes), Layer.mergeAll(), { router: stray.router });
  app.draw(FormerRoutes as never, {});
  flushSync();
  expect(stray.visited).toEqual([{ href: '/runlith/p/notes/42?at=5', replaced: true }]);
  await app.unmount();

  const served = makeRouterWithLog({ url, routeId: '/[project]/memos/[[id]]' });
  app = mountShell(Layer.mergeAll(Surfaces, SurfaceRegistry, notes), Layer.mergeAll(), { router: served.router });
  app.draw(FormerRoutes as never, {});
  flushSync();
  expect(served.visited).toEqual([]);
});

test('a surface merged from outside the features renders through the one contributed route, and a build without it says it has no page there', async () => {
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
  expect([bare.querySelector('[data-testid="extension-page"]'), bare.querySelector('[data-absent]') !== null]).toEqual([null, true]);
});
