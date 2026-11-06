// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { makeRouterWithLog } from '@runlith/layer/testing';
import { mountRepo, stubFamily } from '@runlith/query/testing';
import { QueryClient } from '@tanstack/query-core';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, soloWorkspace, testShellOps, type TestApp } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { PaletteRepo } from '$lib/features/palette/Repo.js';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Asking } from '$lib/features/threads/Asking.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { ActionRegistry } from './ActionRegistry.svelte.js';
import CommandPalette from './CommandPalette.svelte';

await loadCatalog();
let app: TestApp | undefined;
let closeRepo: (() => Promise<void>) | undefined;
afterEach(async () => {
  await app?.unmount();
  await closeRepo?.();
  app = undefined;
  closeRepo = undefined;
});

test('selecting a colliding block search result navigates to its exact identity', async () => {
  const first = '0199000000007000800000001234abcd';
  const second = '1199000000007000800000001234abcd';
  const block = (identity: string, title: string) => ({
    name: '1234abcd',
    identity,
    title,
    snippet: '',
    parentTitle: null,
    tags: [],
    fields: {},
    actions: { moves: [], slots: [], offers: [], revision: '' },
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
  });
  const door = testDoor(
    async () =>
      new Response(JSON.stringify({ status: 'ok', blocks: [block(first, 'First'), block(second, 'Second')], total: 2, next: null }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const { router, visited } = makeRouterWithLog();
  const mounted = mountRepo(PaletteRepo, { door, queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  closeRepo = mounted.unmount;
  app = mountShell(
    Layer.mergeAll(Layer.of(PaletteRepo, mounted.repo), Keymap),
    Layer.mergeAll(
      Layer.of(Door, door),
      Layer.of(Workspace, soloWorkspace({ active: { id: 1, name: 'home' }, activeId: 1, contextProject: { id: 1, name: 'home' } })),
      Layer.of(ActionRegistry, { of: () => [] } as never),
      Layer.of(SectionRegistry, {} as never),
      Layer.of(SettingsRepo, { catalog: stubFamily() } as never),
      Layer.of(FileOpener, {} as never),
      Layer.of(Asking, {} as never),
      Layer.of(Notices, {} as never),
      testShellOps,
    ),
    { at: undefined, router },
  );
  app.draw();
  app.dialogs.open(CommandPalette as never, { group: 'blocks', query: 'note' });
  await waitUntil(() => document.querySelectorAll('[data-palette-row="block"]').length === 2);
  document.querySelectorAll<HTMLElement>('[data-palette-row="block"]')[1]!.click();
  await waitUntil(() => visited.length === 1);
  expect(visited[0]?.href).toBe(`/home/b/${second}`);
});
