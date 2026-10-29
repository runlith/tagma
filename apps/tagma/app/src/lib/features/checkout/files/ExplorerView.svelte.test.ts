// @vitest-environment jsdom
import type { DirectoryEntry } from '@tagma/server/checkout-files/contract/wire/directory';
import type { CheckoutEntry, CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { liveFeed, mountShell, screen, type TestApp, testPlaces } from '$lib/app/testing.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { Holdings } from '$lib/features/checkout/Holdings.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { FileOpener } from './FileOpener.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Outside } from './Outside.svelte.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { Column } from './Column.svelte.js';
import { Explorer } from './Explorer.svelte.js';
import ExplorerView from './ExplorerView.svelte';
import { Door } from '$lib/wire/Door.js';
import { AutoSave } from './AutoSave.svelte.js';
import { Documents } from './Documents.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { FileOps } from './FileOps.svelte.js';
import { FileSearch } from './FileSearch.svelte.js';
import { Tabs } from './Tabs.svelte.js';
import { testDoor } from '$lib/wire/testing.js';

let app: TestApp | undefined;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(720);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(240);
});

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
  vi.restoreAllMocks();
});

const entry = (name: string, kind: DirectoryEntry['kind'] = 'file', mediaType = 'text/plain'): DirectoryEntry =>
  kind === 'file' ? { name, kind, ignored: false, mediaType } : { name, kind, ignored: false };

const LISTINGS: Record<string, readonly DirectoryEntry[]> = {
  '': [entry('src', 'directory'), entry('docs', 'directory'), entry('README.md')],
  src: [entry('deep', 'directory'), entry('a.ts'), entry('b.ts')],
  docs: [entry('guide.md'), entry('manual.pdf', 'file', 'application/pdf')],
  'src/deep': [entry('x.ts')],
};

const changed = (path: string): CheckoutEntry => ({ path, status: 'modified', lines: { added: 1, removed: 0 } });

const area = (entries: readonly CheckoutEntry[]) => ({ entries, added: 0, removed: 0 });

function row(): CheckoutState {
  return {
    rootId: 'root-1',
    path: '/repo',
    revision: 1,
    head: 'f1e2d3c4b5a6',
    ref: 'main',
    upstream: null,
    publishTo: null,
    ahead: 0,
    behind: 0,
    operation: 'none',
    entries: { staged: area([]), unstaged: area([changed('src/a.ts')]), untracked: area([]), unmerged: area([]) },
    compare: null,
    coverage: { untracked: 'all', paths: null },
    repository: true,
    incomplete: false,
    stale: false,
    unwatched: false,
    slowStatus: false,
  } as unknown as CheckoutState;
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  flushSync();
};

async function draw(held: Promise<void> = Promise.resolve()) {
  const feed = liveFeed();
  const asked: unknown[] = [];
  const door = {
    aim: { projectId: 1, branch: null },
    perform: async (_id: string, input: { path?: string }) => {
      asked.push(input);
      if (input.path === 'src') await held;
      const entries = LISTINGS[input.path ?? ''] ?? [];
      return { status: 'ok', entries, total: entries.length, next: null };
    },
  };
  const browsed: string[] = [];
  const placed: unknown[] = [];
  const opener = new FileOpener(
    Object.assign(testDoor(), {
      perform: async (_id: string, input: unknown) => {
        placed.push(input);
        return { entry: null, place: null };
      },
    }) as never,
    () => ({ projectId: 1, branch: null }),
    {} as never,
    {} as never,
    {} as never,
    { refusal: () => undefined } as never,
    { open: (url) => void browsed.push(url) },
    {} as never,
  );
  app = mountShell(
    Layer.mergeAll(
      screen(),
      Checkout,
      Holdings,
      Column,
      Tabs,
      Documents,
      Layer.of(AutoSave, { policyOf: () => ({ mode: 'afterDelay', delay: 1000 }) } as never),
      Layer.of(Door, { perform: () => Promise.reject(new Error('no door')) } as never),
      Explorer,
      FileOps,
      Notices,
      FileSearch,
      ThreadNames,
      ReaderMarks,
      Layer.of(GraphDoor, door as never),
      Layer.of(FileOpener, opener),
      Layer.of(Workspace, { find: () => undefined } as never),
      Layer.of(Worktrees, testPlaces() as never),
      Layer.of(Outside, { local: false, editors: [], chosen: null } as never),
    ),
    Layer.mergeAll(Layer.of(Live, feed.live), Layer.of(ProjectsRepo, { branches: { key: () => ({ data: [] }) } } as never)),
  );
  const page = app.draw(ExplorerView as never);
  flushSync();
  feed.routes.get('checkout.subscribe')?.(row());
  await settle();
  return { page, app: app.app, asked, browsed, placed };
}

test('the root lists when the checkout is known, a folder lists when opened, and a changed file carries its git letter while its folder carries the bubble', async () => {
  const { page, asked } = await draw();
  expect([...page.querySelectorAll('[data-tree-path]')].map((node) => node.getAttribute('data-tree-path'))).toEqual([
    'src',
    'docs',
    'README.md',
  ]);
  expect(asked[0]).toMatchObject({ root: 'root-1' });
  expect(page.querySelector('[data-tree-path="src"] [data-tree-bubble]')).not.toBeNull();

  page.querySelector<HTMLButtonElement>('[data-tree-path="src"]')?.click();
  flushSync();
  await settle();

  expect([...page.querySelectorAll('[data-tree-path]')].map((node) => node.getAttribute('data-tree-path'))).toEqual([
    'src',
    'src/deep',
    'src/a.ts',
    'src/b.ts',
    'docs',
    'README.md',
  ]);
  expect(page.querySelector('[data-tree-path="src/a.ts"] [data-tree-letter]')?.textContent?.trim()).toBe('M');
});

test('a folder pointed at in Files stands open and selected, and an older point settling later does not take the selection', async () => {
  let release = (): void => undefined;
  const { page, app: mounted } = await draw(new Promise<void>((resolve) => (release = resolve)));
  const column = mounted.resolve(Column);
  const explorer = mounted.resolve(Explorer);

  void column.point({ root: 'root-1' as never, path: 'src/deep' }, '/');
  flushSync();
  void column.point({ root: 'root-1' as never, path: 'docs' }, '/');
  flushSync();
  await settle();
  release();
  await settle();
  await settle();

  expect([...explorer.selected]).toEqual(['docs']);
  expect(explorer.expanded.has('docs')).toBe(true);
  expect(page.querySelector('[data-tree-path="docs/guide.md"]')).not.toBeNull();
  expect(column.view).toBe('files');
});

test('a click on a file opens it at once as the preview tab that the next click replaces, and a double click keeps it', async () => {
  const { page, app: mounted, placed } = await draw();
  const tabs = mounted.resolve(Tabs);
  page.querySelector<HTMLButtonElement>('[data-tree-path="src"]')?.click();
  flushSync();
  await settle();

  page.querySelector<HTMLButtonElement>('[data-tree-path="src/a.ts"]')?.click();
  flushSync();
  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([['src/a.ts', 'preview']]);

  page.querySelector<HTMLButtonElement>('[data-tree-path="src/b.ts"]')?.click();
  flushSync();
  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([['src/b.ts', 'preview']]);

  page.querySelector<HTMLButtonElement>('[data-tree-path="src/b.ts"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  flushSync();
  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([['src/b.ts', 'open']]);
  expect(placed).toEqual([]);
});

test('a PDF clicked in the tree goes to the browser by the file opener’s rule and opens no editor tab', async () => {
  const { page, app: mounted, browsed, placed } = await draw();
  page.querySelector<HTMLButtonElement>('[data-tree-path="docs"]')?.click();
  flushSync();
  await settle();

  page.querySelector<HTMLButtonElement>('[data-tree-path="docs/manual.pdf"]')?.click();
  flushSync();

  expect(browsed).toHaveLength(1);
  expect(browsed[0]).toContain('manual.pdf');
  expect(mounted.resolve(Tabs).tabs).toEqual([]);
  expect(placed).toEqual([]);
});
