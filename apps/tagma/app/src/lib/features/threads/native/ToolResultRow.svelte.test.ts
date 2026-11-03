// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { makeRouter } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { waitUntil } from '@runlith/testing/flush';
import { createRawSnippet } from 'svelte';
import { afterEach, expect, test } from 'vitest';

import type { BlockListRow } from '@tagma/server/graph/contract/wire/reads';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
import { mountShell, soloWorkspace, testAddresses, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { type BlockPlace, placedHref } from '$lib/features/graph/blockRefView.js';
import type { Link } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import ToolResultRow from './ToolResultRow.fixture.svelte';
import { drawsOwn } from './ToolResultRow.svelte';

const pointer = {
  truncated: true,
  outputId: 'b2f0c1d4',
  byteLength: 131_072,
  lineCount: 1,
  preview:
    '{"status":"ok","blocks":[{"name":"5940aab8","tags":["claim"]\n... tool output truncated (1 lines, 131072 bytes); full output id: b2f0c1d4 ...',
  format: 'json',
};

const block: BlockListRow = {
  name: '5940aab8',
  identity: '0000000000000000000000005940aab8',
  tags: ['claim'],
  fields: {},
  actions: { moves: [], slots: [], offers: [], revision: 'test' },
  title: 'The Tool Result the Transcript Shows',
  snippet: '',
  parentTitle: null,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function draw(toolOutput: unknown): HTMLElement {
  const entry: ChatEntryOf<'tool'> = {
    id: 'entry-1',
    kind: 'tool',
    toolName: 'query_blocks',
    toolCallId: 'call-1',
    toolState: 'output-available',
    toolOutput,
  };
  app ??= mountShell(
    Layer.mergeAll(
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(SessionNaming, new SessionNaming()),
      Layer.of(BlockTitles, {
        peer: () => ({ title: block.title, project: 'runlith', branch: null }),
        placed: () => null,
      } as never),
      Layer.of(Opening, { knows: () => true, tip: () => ({ text: null }) } as never),
    ),
  );
  return app.draw(ToolResultRow as never, {
    entry,
    markdown: createRawSnippet(() => ({ render: () => '<div></div>' })),
  });
}

test('a retained-value pointer draws the sample it carries and states the size behind it', () => {
  const target = draw(pointer);

  expect(target.querySelector('pre')?.textContent).toBe(pointer.preview);
  expect(target.textContent).toContain('128 KB');
});

test('a graph answer that fits still renders its own arm', () => {
  const target = draw({ status: 'ok', blocks: [block], total: 1 });

  const card = target.querySelector('a');
  expect(card?.textContent).toContain(block.title);
  expect(card?.getAttribute('href')).toContain(block.name);
});

test('the row claims a graph call only once its answer has an arm the row draws', () => {
  const call = (toolState: ChatEntryOf<'tool'>['toolState'], toolOutput?: unknown): ChatEntryOf<'tool'> => ({
    id: 'entry-1',
    kind: 'tool',
    toolName: 'read_block',
    toolCallId: 'call-1',
    toolState,
    toolOutput,
  });

  expect(drawsOwn(call('input-available'))).toBe(false);
  expect(drawsOwn(call('output-available', { status: 'ok', blocks: [], total: 0 }))).toBe(false);
  expect(drawsOwn(call('output-available', { status: 'ok', blocks: [block], total: 1 }))).toBe(true);
});

test('a moved block opens at its destination while its journal preview and range open at the source', async () => {
  await loadCatalog();
  const source = { id: 2, name: 'source', rootPath: '/repo/source' } as Project;
  const destination = { id: 3, name: 'destination', rootPath: '/repo/destination' } as Project;
  const projects = [source, destination];
  const sourceCopy = { projectId: source.id, checkout: '/repo/source-branch', tree: '/graph/source', branch: 'source-branch' };
  const destinationCopy = { projectId: destination.id, checkout: destination.rootPath, tree: '/graph/destination', branch: null };
  const sourceName = '01990000000070008000000011223344';
  const child = 'c0000010';
  const childIdentity = child.padStart(32, '0');
  const requests: { project: string | null; branch: string | null; blockId: string; from: number; to: number }[] = [];
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname !== '/api/op/read_block_diff') throw new Error(`Unexpected request ${request.url}`);
    const body = (await request.json()) as { blockId: string; from: number; to: number };
    requests.push({ project: url.searchParams.get('project'), branch: url.searchParams.get('branch'), ...body });
    return new Response(
      JSON.stringify({
        status: 'ok',
        diff: {
          blockName: body.blockId,
          from: 10,
          to: 11,
          entries: 1,
          sessions: [null],
          ops: [body.blockId === sourceName ? 'depart' : 'update'],
          body: null,
          bodyUnknown: false,
          bodySize: null,
          title: null,
          status: null,
          tag: null,
          changes: [{ kind: 'move', label: 'Moved to destination', peerName: null, peerIdentity: null }],
        },
        marks: [{ blockName: child, identity: childIdentity, mark: 'moved', entries: 1, sessions: [null] }],
        blocks: [],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const router = makeRouter({ url: new URL('https://tagma.test/source') });
  const addresses = testAddresses(router);
  const opened: Link[] = [];
  app = mountShell(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false } } }), GraphDoor, BlocksRepo),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Workspace, soloWorkspace({ projects, find: (id: number) => projects.find((project) => project.id === id) ?? null })),
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(SessionNaming, new SessionNaming()),
      Layer.of(CommitLinks, {} as never),
      Layer.of(BlockTitles, {
        peer: () => undefined,
        placed: (name: string, place: BlockPlace, diff?: string) =>
          placedHref(addresses, name, place, projects.find((project) => project.id === place.projectId) ?? null, diff),
      } as never),
      Layer.of(Opening, {
        knows: () => true,
        modified: () => false,
        how: () => 'beside',
        open: async (link: Link) => void opened.push(link),
        tip: () => ({ text: null }),
      } as never),
    ),
    { at: { projectId: 2, branch: null }, router },
  );
  const target = draw({
    status: 'ok',
    block,
    graphCopy: destinationCopy,
    journal: { from: 10, to: 11, subject: { name: sourceName, copy: sourceCopy } },
  });
  await waitUntil(() => target.textContent?.includes('Moved to destination') === true);
  expect(requests).toEqual([{ project: '2', branch: 'source-branch', blockId: sourceName, from: 10, to: 11 }]);
  const links = [...target.querySelectorAll('a')];
  const card = links.find((link) => link.textContent?.includes(block.title));
  const history = links.find((link) => link.textContent?.includes('View departure'));
  const related = target.querySelector<HTMLAnchorElement>(`a[data-block="${childIdentity}"]`);
  expect(card?.getAttribute('href')).toBe(`/destination/b/${block.identity}`);
  expect(history?.getAttribute('href')).toBe(`/source/b/${sourceName}?branch=source-branch&diff=10..11`);
  expect(related?.getAttribute('href')).toBe(`/source/b/${childIdentity}?branch=source-branch`);
  card?.click();
  history?.click();
  related?.click();
  expect(opened.map((link) => link.target)).toEqual([
    { name: block.identity, copy: { projectId: destination.id, branch: null }, diff: undefined },
    { name: sourceName, copy: { projectId: source.id, branch: 'source-branch' }, diff: '10..11' },
    { name: childIdentity, copy: { projectId: source.id, branch: 'source-branch' } },
  ]);

  const ordinary = draw({ status: 'ok', block, graphCopy: destinationCopy, journal: { from: 10, to: 11 } });
  await waitUntil(() => requests.length === 2);
  expect(requests[1]).toEqual({ project: '3', branch: null, blockId: block.identity, from: 10, to: 11 });
  await waitUntil(() => ordinary.querySelector('a')?.getAttribute('href')?.includes('diff=10..11') === true);
  expect(ordinary.querySelector('a')?.getAttribute('href')).toBe(`/destination/b/${block.identity}?diff=10..11`);
});
