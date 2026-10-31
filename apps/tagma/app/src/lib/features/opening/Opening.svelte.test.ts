// @vitest-environment jsdom
import { linksClick } from '@tagma/server/settings/contract/wire/links';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Host } from '@runlith/layer/Host';
import type { KeyClass, Resolver } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import { makeRouterWithLog } from '@runlith/layer/testing';
import { waitUntil } from '@runlith/testing/flush';
import { expect, test } from 'vitest';
import { besideOf } from '$lib/app/opening/beside.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { testAddresses, testLinks } from '$lib/app/testing.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { Links } from '$lib/features/browser/Links.svelte.js';
import { OpenPages } from '$lib/features/browser/OpenPages.svelte.js';
import { BROWSER_PANE, shownOf } from '$lib/features/browser/panes.js';
import { commitLink, directoryLink, fileLink } from '$lib/features/checkout/links.js';
import { Column } from '$lib/features/checkout/files/Column.svelte.js';
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { Outside } from '$lib/features/checkout/files/Outside.svelte.js';
import { COMMIT_PANE, commitOf, FILE_PANE, fileTargetOf } from '$lib/features/checkout/paneContent.js';
import { BLOCK_PANE, placedBlockOf } from '$lib/features/graph/blockPane.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { blockLink } from '$lib/features/graph/links.js';
import { siteLink } from '$lib/features/browser/links.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { threadLink } from '$lib/features/presence/link.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ShellOps } from '$lib/features/workspace/ShellOps.js';
import { sectionHolder, threadHolder } from '$lib/shared/panes/holder.js';
import { openLinks } from '@tagma/server/browser/contract/wire/settings';
import { Effect } from 'effect';
import { Beside } from './Beside.js';
import { Opening } from './Opening.svelte.js';

const ROOT = 'root-main' as RootId;
const RUNLITH = { id: 1, name: 'runlith', rootPath: '/work/main' };

function world(click: 'beside' | 'section') {
  const { panes } = testArea([testKind(FILE_PANE), testKind(BLOCK_PANE), testKind(COMMIT_PANE), testKind(BROWSER_PANE)]);
  const seats = new ThreadSeats(panes);
  const { router, visited } = makeRouterWithLog({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') });
  const refused: unknown[] = [];
  const system: string[] = [];
  const threads: unknown[] = [];
  const shown: unknown[] = [];
  const knowledge: string[] = [];
  const notices = { refusal: (error: unknown) => void refused.push(error), error: () => 0 } as unknown as Notices;
  const settings = {
    catalog: {
      key: () => ({
        data: {
          entries: [
            { id: linksClick.id, value: click },
            { id: openLinks.id, value: true },
          ],
        },
      }),
    },
    write: { data: undefined },
  } as never;
  const workspace = { contextProject: RUNLITH, projects: [RUNLITH], find: () => RUNLITH } as unknown as Workspace;
  const pages = new Map<string, { url: string }>();
  const folders: Record<string, unknown> = {
    '/work/main/migrations': {
      entry: { kind: 'directory', path: '/work/main/migrations' },
      place: { projectId: 1, checkout: ROOT, root: '/work/main', path: 'migrations' },
    },
    '/tmp/x': { entry: { kind: 'directory', path: '/tmp/x' }, place: null },
    '/work/main/gone': { entry: null, place: null },
  };
  const door = {
    perform: async (id: string, input: { path?: string; url?: string }) => {
      if (id === 'open_page') pages.set(`page-${pages.size + 1}`, { url: input.url ?? '' });
      return id === 'open_page'
        ? { page: { id: `page-${pages.size}` } }
        : (folders[input.path ?? ''] ?? {
            entry: { kind: 'file', path: `/work/main/${input.path}`, bytes: 1, mediaType: 'text/plain' },
            place: { projectId: 1, checkout: ROOT, root: '/work/main', path: 'src/a.ts' },
          });
    },
  } as never;
  const beside = besideOf(panes, seats);
  const addresses = testAddresses(router);
  const projects = {
    list: { loadOrThrow: async () => [RUNLITH] },
    branches: { key: () => ({ loadOrThrow: async () => [{ branch: 'main', worktree: '/work/main', canonical: true }] }) },
  } as never;
  const pointed: unknown[] = [];
  const revealed: string[] = [];
  const opener = new FileOpener(
    door,
    () => ({ projectId: 1, branch: null }),
    projects,
    router,
    addresses,
    notices,
    { open: () => undefined },
    beside,
  );
  opener.stand({ projectId: 1, branch: null }, { rootId: () => ROOT, show: (located) => void shown.push(located) });
  const services = new Map<unknown, unknown>([
    [FileOpener, opener],
    [Beside, beside],
    [Router, router],
    [Addresses, addresses],
    [Workspace, workspace],
    [Notices, notices],
    [
      BlockTitles,
      {
        copy: async () => ({ projectId: 1, branch: null }),
        peer: () => undefined,
        open: async (name: string) => void knowledge.push(name),
      },
    ],
    [ShellOps, { openThread: (address: unknown, target: unknown) => Effect.sync(() => void threads.push([address, target])) }],
    [ThreadList, { homeOf: () => 1 }],
    [OpenPages, { listing: { byId: pages } }],
    [Links, new Links(door, beside, () => ({ projectId: 1 }), settings, notices, { open: (url) => void system.push(url) })],
    [Column, { point: async (at: unknown, href: string) => void pointed.push([at, href]) }],
    [Outside, { local: true, finder: 'Reveal in Finder', reveal: async (file: { path: string }) => void revealed.push(file.path) }],
  ]);
  const app: Resolver = { resolve: <Self>(key: KeyClass<string, Self>) => services.get(key) as Self };
  const opening = new Opening(testLinks(), settings, workspace, notices, new Host('desktop', 'macos'));
  const tabs = (holder = sectionHolder('test')) => panes.layouts?.layout(holder).tabs ?? [];
  const press = (link: Parameters<Opening['open']>[0], modified: boolean) => opening.open(link, opening.how(modified), app);
  const paths = () => visited.map((visit) => new URL(visit.href, 'https://tagma.test').pathname);
  return { opening, app, router, press, tabs, paths, system, threads, shown, knowledge, refused, pages, pointed, revealed };
}

test('a block anchor of Knowledge keeps the copy its address names: the modified click opens that copy beside, and its menu names the click as Knowledge', async () => {
  const at = world('beside');
  const detach = at.opening.attach(at.app);
  const stop = at.opening.listen(at.router);
  const anchor = document.createElement('a');
  anchor.href = 'https://tagma.test/runlith/b/5940aab8?branch=feature%2Fone';
  anchor.dataset['block'] = '5940aab8';
  document.body.append(anchor);
  try {
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    await waitUntil(() => at.tabs().length > 0);
    expect(at.tabs()).toHaveLength(1);
    expect(placedBlockOf(at.tabs()[0]!.id)).toEqual({ projectId: 1, branch: 'feature/one', name: '5940aab8', diff: null, lang: null });

    anchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    const aim = at.opening.aim;
    expect(aim?.link).toEqual({
      kind: 'block',
      target: { name: '5940aab8', copy: { projectId: 1, branch: 'feature/one' }, diff: undefined },
    });
    expect(aim?.click).toBe('full');
    expect(at.refused).toEqual([]);
  } finally {
    stop();
    detach();
    anchor.remove();
  }
});

test('a directory link asks the server again at the click: a folder of a checkout opens in its Files, one outside every checkout in the file manager, and one gone since opens nothing', async () => {
  const at = world('beside');
  const place = { projectId: 1, checkout: ROOT, root: '/work/main', path: 'migrations' };

  await at.press(directoryLink({ absolute: '/work/main/migrations', place }), false);
  await at.press(directoryLink({ absolute: '/tmp/x', place: null }), true);
  await at.press(directoryLink({ absolute: '/work/main/gone', place: { ...place, path: 'gone' } }), false);

  expect(at.pointed).toEqual([[{ root: ROOT, path: 'migrations' }, '/runlith/checkout?view=tree']]);
  expect(at.revealed).toEqual(['/tmp/x']);
  expect(at.tabs()).toEqual([]);
  expect(at.refused).toEqual([]);
});

test('a click opens each kind of link beside in the holder on screen, once however often, and the modified click opens its full place', async () => {
  const at = world('beside');

  await at.press(fileLink({ path: 'src/a.ts', line: 3 }), false);
  await at.press(fileLink({ path: 'src/a.ts', line: 9 }), false);
  await at.press(blockLink({ name: '5940aab8' }), false);
  await at.press(blockLink({ name: '5940aab8' }), false);
  await at.press(commitLink({ sha: 'b4dc210b5e11', project: 'runlith' }), false);
  await at.press(commitLink({ sha: 'b4dc210b5e11', project: 'runlith' }), false);
  await at.press(siteLink('https://example.com/a'), false);
  await at.press(siteLink('https://example.com/a'), false);
  await at.press(threadLink({ threadId: 'thread-2' }), false);

  expect(at.tabs().map((tab) => [tab.kind, tab.id])).toEqual([
    [FILE_PANE, expect.any(String)],
    [BLOCK_PANE, expect.any(String)],
    [COMMIT_PANE, expect.any(String)],
    [BROWSER_PANE, expect.any(String)],
  ]);
  const [file, block, commit, page] = at.tabs();
  expect(fileTargetOf(file!.id)).toEqual({ projectId: 1, rootId: ROOT, path: 'src/a.ts', at: { line: 9, column: null } });
  expect(placedBlockOf(block!.id)).toEqual({ projectId: 1, branch: null, name: '5940aab8', diff: null, lang: null });
  expect(commitOf(commit!.id)).toEqual({ projectId: 1, sha: 'b4dc210b5e11' });
  expect(shownOf(page!.id)).toEqual({ project: 1, page: 'page-1' });
  expect([...at.pages.keys()]).toEqual(['page-1']);
  expect(at.threads).toEqual([[{ projectId: 1, threadId: 'thread-2' }, 'beside']]);
  expect(at.paths()).toEqual([]);

  await at.press(fileLink({ path: 'src/a.ts', line: 3 }), true);
  await at.press(blockLink({ name: '5940aab8' }), true);
  await at.press(commitLink({ sha: 'b4dc210b5e11', project: 'runlith' }), true);
  await at.press(siteLink('https://example.com/a'), true);
  await at.press(threadLink({ threadId: 'thread-2' }), true);

  expect(at.tabs()).toHaveLength(4);
  expect(at.shown).toEqual([{ rootId: ROOT, projectId: 1, path: 'src/a.ts', branch: null, line: 3, column: null }]);
  expect(at.paths()).toEqual(['/runlith/checkout', '/runlith/checkout']);
  expect(at.knowledge).toEqual(['5940aab8']);
  expect(at.system).toEqual(['https://example.com/a']);
  expect(at.threads.at(-1)).toEqual([{ projectId: 1, threadId: 'thread-2' }, 'main']);
  expect(at.refused).toEqual([]);
});

test('a link from a thread opens beside in that thread’s own layout while the thread is not on screen', async () => {
  const at = world('beside');
  await at.press(fileLink({ path: 'src/a.ts' }, { thread: 'thread-1' }), false);
  expect(at.tabs(threadHolder('thread-1')).map((tab) => tab.kind)).toEqual([FILE_PANE]);
  expect(at.tabs()).toEqual([]);
});

test('a site link from a thread off screen opens one page in that thread’s layout however often it is clicked', async () => {
  const at = world('beside');
  await at.press(siteLink('https://example.com/a', { thread: 'thread-1' }), false);
  await at.press(siteLink('https://example.com/a', { thread: 'thread-1' }), false);
  expect(at.tabs(threadHolder('thread-1')).map((tab) => tab.kind)).toEqual([BROWSER_PANE]);
  expect([...at.pages.keys()]).toEqual(['page-1']);
});

test('with clicks set to the section, the click opens each kind in its full place and the modified click opens it beside', async () => {
  const at = world('section');
  const links = [
    fileLink({ path: 'src/a.ts', line: 3 }),
    blockLink({ name: '5940aab8' }),
    commitLink({ sha: 'b4dc210b5e11', project: 'runlith' }),
    siteLink('https://example.com/a'),
    threadLink({ threadId: 'thread-2' }),
  ];
  for (const link of links) await at.press(link, false);

  expect(at.tabs()).toEqual([]);
  expect(at.shown).toHaveLength(1);
  expect(at.knowledge).toEqual(['5940aab8']);
  expect(at.paths()).toEqual(['/runlith/checkout', '/runlith/checkout']);
  expect(at.system).toEqual(['https://example.com/a']);
  expect(at.threads).toEqual([[{ projectId: 1, threadId: 'thread-2' }, 'main']]);

  for (const link of links) await at.press(link, true);

  expect(at.tabs().map((tab) => tab.kind)).toEqual([FILE_PANE, BLOCK_PANE, COMMIT_PANE, BROWSER_PANE]);
  expect(at.threads.at(-1)).toEqual([{ projectId: 1, threadId: 'thread-2' }, 'beside']);
  expect(at.refused).toEqual([]);
});
