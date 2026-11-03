// @vitest-environment jsdom
import type { Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { makeRouter, makeStorage } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { flush } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, soloWorkspace, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
import { PathRoads } from '$lib/features/checkout/PathRoads.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import BlockSeat from '$lib/features/graph/BlockSeat.svelte';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
import { JournalLive } from '$lib/features/graph/journal/Live.svelte.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { TagsRepo } from '$lib/features/graph/TagsRepo.js';
import { ThreadWork } from '$lib/features/graph/ThreadWork.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Link } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { SessionNaming } from '$lib/wire/SessionNaming.svelte.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { TranslationLayer } from '$lib/features/graph/translation/layer.js';
import { LinksPlacement } from './LinksPlacement.svelte.js';
import BlockPage from './BlockPage.svelte';

await loadCatalog();

const AT = '2026-10-28T10:00:00Z';
const LATER = '2026-10-28T11:00:00Z';
const REVISION = 'tagma';

const module: Tag = {
  id: 'module',
  fields: {},
  edges: ['relates'],
  gates: [],
  roles: {},
  contracts: { 'core/container': { slots: {}, words: {} } },
  body: { shape: 'orientation' },
  prompt: 'A part of the product.',
};

const task: Tag = {
  id: 'task',
  fields: { status: { type: 'enum', values: ['open', 'done', 'closed'] } },
  edges: ['relates'],
  gates: [],
  roles: {},
  contracts: { 'core/lifecycle': { slots: { status: 'status' }, words: { initial: 'open', done: 'done', closed: 'closed' } } },
  body: { shape: 'orientation' },
  prompt: 'A piece of work.',
};

const rule: Tag = { id: 'rule', fields: {}, edges: ['relates'], gates: [], roles: {}, body: { shape: 'content' }, prompt: 'A norm.' };

const VOCABULARY: Vocabulary = {
  catalogs: [],
  installed: [],
  findings: [],
  tags: [module, task, rule],
  unreadable: [],
  actions: {},
  fieldNames: {},
  forms: {},
  laws: {},
  revision: { format: 2, revision: REVISION },
};

const ROOT = 'f0000000';
const PART = 'a0000001';
const PAGE = 'a0000002';
const MODULE = 'c0000001';
const EMPTY = 'a0000003';
const NOTE = 'a0000004';
const DEPARTED = '019900000000700080000000d0000001';
const DEPARTED_CHILD = 'd0000002';
const TWIN = `${DEPARTED.slice(0, -12)}1${DEPARTED.slice(-11)}`;
const identityOf = (name: string) => name.padStart(32, '0');

const row = (
  name: string,
  parentName: string | null,
  ord: number,
  title: string,
  tags: readonly string[] = [],
  fields = {},
): TreeBlock => ({
  name,
  ...{
    identity: identityOf(name),
    rowKey: Number.parseInt(name.slice(-8), 16),
    parentIdentity: parentName === null ? null : identityOf(parentName),
  },
  projectId: 1,
  parentName,
  ord,
  tags,
  fields,
  actions: { moves: [], slots: [], offers: [], revision: REVISION },
  title,
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: AT,
  updatedAt: AT,
});

function graph(): Map<string, TreeBlock> {
  const rows = [
    row(ROOT, null, 0, 'tagma'),
    row(PART, ROOT, 1, 'Agents'),
    row(PAGE, PART, 1, 'Threads'),
    row(MODULE, PAGE, 1, 'Agent threads', ['module']),
    row(EMPTY, PART, 2, 'Schedules'),
    row(NOTE, PART, 3, 'How agents start'),
    row('a0000005', NOTE, 1, 'Spawning a child', ['task'], { status: 'open' }),
    row('c0000002', MODULE, 1, 'Thread record', ['module']),
    row('b0000001', PART, 4, 'An agent names its model', ['rule']),
  ];
  return new Map(rows.map((block) => [block.name, block]));
}

const read = (block: TreeBlock) => ({
  ...block,
  body: '',
  edgesOut: [],
  edgesIn: [],
  refsOutDetails: [],
  refsInDetails: [],
  restingIn: { edges: [], refsDetails: [] },
  sources: [],
  reach: null,
  ending: null,
  author: null,
  answeredBy: null,
  answeredCommit: null,
  answeredCheck: null,
  results: null,
  shape: { blocks: 1, depth: 0, widest: 0 },
  children: [],
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

test('a part page in the main pane and another block in the right-hand tab both stand, and only opening a block moves it up the trail', async () => {
  const rows = graph();
  rows.set(TWIN, { ...row(TWIN.slice(-8), PART, 5, 'Same-name neighbour'), ...{ identity: TWIN, rowKey: 9_000_000_001 } });
  const trashed = {
    ...row(DEPARTED.slice(-8), PART, 1, 'Departed'),
    identity: DEPARTED,
    rowKey: 9_000_000_002,
    body: '',
    deletedAt: LATER,
  };
  let restored = false;
  let movedAgain = false;
  const replacement = `1199${DEPARTED.slice(4)}`;
  const replacementDiff = Promise.withResolvers<void>();
  const diffs: { blockId: string; from: number; to: number }[] = [];
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/op/read_tree') return json({ status: 'ok', blocks: [...rows.values()] });
    if (path === '/api/op/ready_work') return json({ status: 'ok', tasks: [], shown: 0, total: 0, next: null, complete: true });
    if (path === '/api/op/list_trash') {
      return json({
        status: 'ok',
        blocks: restored ? [] : [trashed],
      });
    }
    if (path === '/api/op/restore_block') {
      const { blockId } = (await request.json()) as { blockId: string };
      if (blockId !== DEPARTED) throw new Error(`Restored another block: ${blockId}`);
      restored = true;
      rows.set(DEPARTED, { ...row(DEPARTED.slice(-8), PART, 4, 'Departed'), ...{ identity: DEPARTED, rowKey: 9_000_000_002 } });
      rows.set(identityOf(DEPARTED_CHILD), {
        ...row(DEPARTED_CHILD, DEPARTED.slice(-8), 1, 'Restored child'),
        ...{ parentIdentity: DEPARTED },
      });
      return json({ status: 'ok', block: rows.get(DEPARTED) });
    }
    if (path === '/api/op/update_block') {
      const { blockId, title } = (await request.json()) as { blockId: string; title: string };
      if (blockId !== DEPARTED) throw new Error(`Updated another block: ${blockId}`);
      const updated = { ...rows.get(DEPARTED)!, title, updatedAt: LATER };
      rows.set(DEPARTED, updated);
      return json({ status: 'ok', block: updated });
    }
    if (path === '/api/op/read_block') {
      const { blockIds } = (await request.json()) as { blockIds: string[] };
      if ((blockIds.includes(DEPARTED) || blockIds.includes(DEPARTED.slice(-12))) && !restored) {
        return new Response(JSON.stringify({ code: 'deleted', reason: 'In the trash', unblock: ['restore_block'] }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (blockIds.includes(DEPARTED) && movedAgain) {
        return json({ status: 'ok', reads: [read({ ...rows.get(DEPARTED)!, projectId: 2, rowKey: 77, title: 'Moved original' })] });
      }
      return json({
        status: 'ok',
        reads: blockIds.map((name) => {
          const selected = name === DEPARTED.slice(-12) ? (movedAgain ? replacement : DEPARTED) : name;
          const block = rows.get(selected) ?? [...rows.values()].find((row) => row.identity === selected)!;
          const detail = read(block);
          if (restored && block.identity === DEPARTED) return { ...detail, refsOutDetails: [{ name: TWIN.slice(-8), identity: TWIN }] };
          if (restored && block.identity === TWIN) return { ...detail, refsInDetails: [{ name: DEPARTED.slice(-8), identity: DEPARTED }] };
          return detail;
        }),
      });
    }
    if (path === '/api/op/read_block_diff') {
      const asked = (await request.json()) as { blockId: string; from: number; to: number };
      diffs.push(asked);
      if (asked.blockId === replacement) await replacementDiff.promise;
      return json({
        status: 'ok',
        diff: {
          blockName: DEPARTED.slice(-8),
          from: 10,
          to: 11,
          entries: 1,
          sessions: [null],
          ops: ['depart'],
          body: null,
          bodyUnknown: false,
          bodySize: null,
          title: null,
          status: null,
          tag: null,
          changes: [
            {
              kind: 'move',
              label: asked.blockId === replacement ? 'Replacement history' : 'Moved to destination',
              peerName: null,
              peerIdentity: null,
            },
          ],
        },
        marks: [{ blockName: DEPARTED_CHILD, identity: identityOf(DEPARTED_CHILD), mark: 'moved', entries: 1, sessions: [null] }],
        blocks: [],
      });
    }
    throw new Error(`Unexpected request ${request.url}`);
  };
  const frames: ((frame: GraphFrame) => void)[] = [];
  const failures: unknown[] = [];
  const opened: Link[] = [];
  const tags = testTagCatalog(1, async () => VOCABULARY);
  const project = { id: 1, name: 'tagma' };
  const storage = makeStorage({ 'tagma.expanded.1': JSON.stringify([...graph().keys()]) });
  app = mountShell(
    Layer.mergeAll(
      Cache.of({ defaultOptions: { queries: { retry: false } } }),
      GraphDoor,
      BlocksRepo,
      JournalRepo,
      SessionsRepo,
      SelectionRepo,
      GraphFeed,
      ProjectTree,
      HiddenStates,
      ReaderMarks,
      ReadState,
      JournalLive,
      Visits,
      LinksPlacement,
      TranslationLayer,
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, {
        hold: (_open: unknown, frame: (frame: GraphFrame) => void) => {
          frames.push(frame);
          return { unsubscribe: () => undefined };
        },
      } as never),
      Layer.of(TagCatalog, tags),
      Layer.of(SessionRegistry, { writerOf: () => null } as never),
      Layer.of(SessionNaming, new SessionNaming()),
      Layer.of(ThreadWork, {} as never),
      Layer.of(ThreadNames, new ThreadNames(() => null)),
      Layer.of(BlockTitles, { answered: 0, peer: () => null } as never),
      Layer.of(CommitLinks, {} as never),
      Layer.of(PathRoads, { road: () => async () => null } as never),
      Layer.of(Checkout, { row: null } as never),
      Layer.of(Opening, {
        knows: () => true,
        modified: () => false,
        how: () => 'beside',
        open: async (link: Link) => void opened.push(link),
        menu: () => undefined,
        tip: () => ({ text: null }),
      } as never),
      Layer.of(Notices, {
        undoable: () => undefined,
        background: (error: unknown) => void failures.push(error),
        refusal: (error: unknown) => void failures.push(error),
      } as never),
      Layer.of(
        Workspace,
        soloWorkspace({
          active: project,
          contextProject: project,
          find: (id: number) => (id === project.id ? project : null),
          nameOf: async () => 'tagma',
        }),
      ),
      Failure.of((error) => void failures.push(error)),
    ),
    {
      at: { projectId: 1, branch: null },
      storage,
      router: makeRouter({ params: { project: 'tagma', id: PART }, url: new URL(`https://tagma.test/tagma/b/${PART}`) }),
    },
  );
  await tags.read();
  const scope = app.app.scopeOf('graph');
  await app.app.resolve(ProjectTree, scope).reload();
  const readState = app.app.resolve(ReadState, scope);

  const titleOf = (target: HTMLElement): string | undefined => target.querySelector('[aria-label="Title"]')?.textContent ?? undefined;
  const main = app.draw(BlockPage as never, { blockName: PART });
  await vi.waitFor(() => {
    expect(titleOf(main)).toBe('Agents');
    expect(main.querySelector(`a[data-block="${identityOf(MODULE)}"]`)).not.toBeNull();
  });
  const side = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: MODULE, diff: null } });
  await vi.waitFor(() => expect(titleOf(side)).toBe('Agent threads'));
  flushSync();

  expect(readState.trailOf).toEqual([identityOf(MODULE), identityOf(PART)]);

  const renamed = { ...rows.get(PART)!, title: 'Agents and teams', updatedAt: LATER };
  rows.set(PART, renamed);
  for (const frame of frames)
    frame({
      type: 'change',
      projectId: 1,
      events: [],
      sessions: [],
      blocks: [renamed],
      edges: [],
      refs: [],
      ready: [],
      readyIdentities: [],
      trash: [trashed],
    });
  await vi.waitFor(() => expect(titleOf(main)).toBe('Agents and teams'));
  flushSync();

  expect(readState.trailOf).toEqual([identityOf(MODULE), identityOf(PART)]);
  expect(readState.isUnread(identityOf(PART), LATER)).toBe(false);
  expect(titleOf(side)).toBe('Agent threads');
  expect(failures).toEqual([]);

  const partial = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: DEPARTED.slice(-12), diff: null } });
  await vi.waitFor(() => expect(partial.textContent).toContain('Departed'));
  const departure = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: DEPARTED, diff: '10..11' } });
  await vi.waitFor(() => expect(departure.textContent).toContain('In the trash'));
  expect(failures).toEqual([]);
  expect(departure.textContent).toContain('In the trash');
  await vi.waitFor(() => expect(departure.textContent).toContain('Departed'));
  await flush();
  expect(diffs).toEqual([{ blockId: DEPARTED, from: 10, to: 11 }]);
  await vi.waitFor(() => expect(departure.textContent).toContain('Moved to destination'));
  const related = departure.querySelector<HTMLAnchorElement>(`a[data-block="${identityOf(DEPARTED_CHILD)}"]`);
  expect(related?.getAttribute('href')).toBe(`/tagma/b/${identityOf(DEPARTED_CHILD)}`);
  related?.click();
  expect(opened.map((link) => link.target)).toEqual([{ name: identityOf(DEPARTED_CHILD), copy: { projectId: 1, branch: null } }]);
  const restore = [...departure.querySelectorAll('button')].find((button) => button.textContent?.includes('Restore'));
  expect(restore).toBeDefined();
  restore?.click();
  await vi.waitFor(() => expect(titleOf(departure)).toBe('Departed'));
  await vi.waitFor(() => expect(departure.textContent).toContain('Restored child'));
  const title = departure.querySelector<HTMLElement>('[aria-label="Title"]');
  if (title === null) throw new Error('The restored block has no editable title');
  title.textContent = 'Restored source';
  title.dispatchEvent(new Event('blur'));
  await vi.waitFor(() => expect(rows.get(DEPARTED)?.title).toBe('Restored source'));
  await vi.waitFor(() => expect(titleOf(departure)).toBe('Restored source'));
  expect(rows.get(TWIN)?.title).toBe('Same-name neighbour');
  const source = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: DEPARTED, diff: null } });
  await vi.waitFor(() => expect(source.querySelector(`a[data-block="${TWIN}"]`)).not.toBeNull());
  const twin = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: TWIN, diff: null } });
  await vi.waitFor(() => expect(twin.querySelector(`a[data-block="${DEPARTED}"]`)).not.toBeNull());
  const ranged = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: DEPARTED.slice(-12), diff: '10..11' } });
  await vi.waitFor(() => expect(ranged.textContent).toContain('Moved to destination'));

  movedAgain = true;
  const next = { ...row(replacement.slice(-8), PART, 5, 'Replacement'), identity: replacement, rowKey: 9_000_000_003 };
  rows.set(replacement, next);
  const renamedParent = {
    ...rows.get(DEPARTED)!,
    identity: '219900000000700080000000d0000001',
    title: 'Renamed source trash',
    deletedAt: LATER,
  };
  const renamedChild = {
    ...rows.get(identityOf(DEPARTED_CHILD))!,
    identity: '219900000000700080000000d0000002',
    parentIdentity: renamedParent.identity,
    deletedAt: LATER,
  };
  try {
    for (const frame of frames)
      frame({
        type: 'change',
        projectId: 1,
        events: [],
        sessions: [],
        blocks: [renamedParent, renamedChild, next],
        edges: [],
        refs: [],
        ready: [],
        readyIdentities: [],
        trash: [renamedParent],
      });
    await vi.waitFor(() => expect(diffs.some((asked) => asked.blockId === replacement)).toBe(true));
    await vi.waitFor(() => expect(titleOf(ranged)).toBe('Replacement'));
    expect(ranged.textContent).not.toContain('Moved to destination');
  } finally {
    replacementDiff.resolve();
  }
  await vi.waitFor(() => expect(ranged.textContent).toContain('Replacement history'));
  await vi.waitFor(() => expect(titleOf(departure)).toBe('Moved original'));
  expect(departure.textContent).not.toContain('Renamed source trash');
  expect(titleOf(main)).toBe('Agents and teams');
  expect(titleOf(side)).toBe('Agent threads');
  expect(failures).toEqual([]);
});

test('a project root opened in a tab from another project lists its parts beside the window project’s Knowledge page', async () => {
  const HONO = 2;
  const HONO_ROOT = 'e0000000';
  const HONO_PART = 'e0000001';
  const NEW_ROOT = 'f0000009';
  let holdRoot = false;
  let rootAsked = false;
  let newRootAsked = false;
  const releaseRoot = Promise.withResolvers<void>();
  const releaseNewRoot = Promise.withResolvers<void>();
  const honoRow = (name: string, parentName: string | null, title: string): TreeBlock => ({
    ...row(name, parentName, 1, title),
    projectId: HONO,
    actions: { moves: [], slots: [], offers: [], revision: 'hono' },
  });
  const graphs = new Map([
    [1, graph()],
    [
      HONO,
      new Map([honoRow(HONO_ROOT, null, 'hono'), honoRow(HONO_PART, HONO_ROOT, 'HTTP framework')].map((block) => [block.name, block])),
    ],
  ]);
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const project = Number(url.searchParams.get('project'));
    const rows = graphs.get(project)!;
    if (url.pathname === '/api/op/read_vocabulary')
      return json({ status: 'ok', ...VOCABULARY, revision: { format: 2, revision: project === HONO ? 'hono' : REVISION } });
    if (url.pathname === '/api/op/read_tree') return json({ status: 'ok', blocks: [...rows.values()] });
    if (url.pathname === '/api/op/ready_work') return json({ status: 'ok', tasks: [], shown: 0, total: 0, next: null, complete: true });
    if (url.pathname === '/api/op/list_trash') return json({ status: 'ok', blocks: [] });
    if (url.pathname === '/api/op/read_block') {
      const { blockIds } = (await request.json()) as { blockIds: string[] };
      const selected = blockIds.map((name) => {
        const block = rows.get(name) ?? [...rows.values()].find((row) => row.identity === name)!;
        return { ...read(block), body: `Body of ${block.title}` };
      });
      if (project === 1 && blockIds.includes(identityOf(ROOT)) && holdRoot) {
        rootAsked = true;
        await releaseRoot.promise;
      }
      if (project === 1 && blockIds.includes(identityOf(NEW_ROOT)) && holdRoot) {
        newRootAsked = true;
        await releaseNewRoot.promise;
      }
      return json({ status: 'ok', reads: selected });
    }
    throw new Error(`Unexpected request ${request.url}`);
  };
  const frames: ((frame: GraphFrame) => void)[] = [];
  const failures: unknown[] = [];
  const project = { id: 1, name: 'tagma' };
  app = mountShell(
    Layer.mergeAll(
      Cache.of({ defaultOptions: { queries: { retry: false } } }),
      GraphDoor,
      BlocksRepo,
      JournalRepo,
      SessionsRepo,
      SelectionRepo,
      TagsRepo,
      TagCatalog,
      GraphFeed,
      ProjectTree,
      HiddenStates,
      ReaderMarks,
      ReadState,
      JournalLive,
      Visits,
      LinksPlacement,
      TranslationLayer,
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, {
        hold: (_open: unknown, frame: (frame: GraphFrame) => void) => {
          frames.push(frame);
          return { unsubscribe: () => undefined };
        },
      } as never),
      Layer.of(SessionRegistry, { writerOf: () => null } as never),
      Layer.of(SessionNaming, new SessionNaming()),
      Layer.of(ThreadWork, {} as never),
      Layer.of(ThreadNames, new ThreadNames(() => null)),
      Layer.of(BlockTitles, { answered: 0, peer: () => null } as never),
      Layer.of(CommitLinks, {} as never),
      Layer.of(PathRoads, { road: () => async () => null } as never),
      Layer.of(Checkout, { row: null } as never),
      Layer.of(Opening, {
        knows: () => true,
        modified: () => false,
        how: () => 'beside',
        open: async () => undefined,
        menu: () => undefined,
        tip: () => ({ text: null }),
      } as never),
      Layer.of(Notices, {
        undoable: () => undefined,
        background: (error: unknown) => void failures.push(error),
        refusal: (error: unknown) => void failures.push(error),
      } as never),
      Layer.of(Workspace, soloWorkspace({ active: project, contextProject: project, contextId: project.id, nameOf: async () => 'tagma' })),
      Failure.of((error) => void failures.push(error)),
    ),
    {
      at: { projectId: 1, branch: null },
      router: makeRouter({ params: { project: 'tagma' }, url: new URL('https://tagma.test/tagma') }),
    },
  );

  const knowledge = app.draw(BlockPage as never, {});
  const foreignRoot = app.draw(BlockSeat as never, { placed: { projectId: HONO, branch: null, name: HONO_ROOT, diff: null } });
  const ownRoot = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: ROOT, diff: null } });
  for (const frame of frames) frame({ type: 'resync' });

  const lists = (target: HTMLElement, name: string): boolean => target.querySelector(`a[data-block="${identityOf(name)}"]`) !== null;
  await vi.waitFor(() => {
    expect(lists(knowledge, PART)).toBe(true);
    expect(lists(ownRoot, PART)).toBe(true);
    expect(foreignRoot.textContent).toContain('Add block');
  });
  flushSync();

  expect(lists(foreignRoot, HONO_PART)).toBe(true);
  expect(failures).toEqual([]);

  expect(knowledge.textContent).toContain('Body of tagma');
  holdRoot = true;
  for (const frame of frames) frame({ type: 'resync' });
  const late = app.draw(BlockPage as never, {});
  try {
    await vi.waitFor(() => expect(rootAsked).toBe(true));
    expect(knowledge.textContent).not.toContain('Body of tagma');
    const newRoot = { ...row(NEW_ROOT, null, 0, 'New root'), rowKey: Number.parseInt(ROOT, 16) };
    graphs.set(1, new Map([[NEW_ROOT, newRoot]]));
    for (const frame of frames) frame({ type: 'resync' });
    const tree = app.app.resolve(ProjectTree, app.app.scopeOf('graph'));
    await vi.waitFor(() => expect(tree.rootName).toBe(identityOf(NEW_ROOT)));
    releaseRoot.resolve();
    await vi.waitFor(() => expect(newRootAsked).toBe(true));
    await flush();
    expect(late.textContent).not.toContain('Body of tagma');
    releaseNewRoot.resolve();
    await vi.waitFor(() => {
      expect(late.querySelector('[aria-label="Title"]')?.textContent).toBe('New root');
      expect(late.textContent).toContain('Body of New root');
    });
  } finally {
    releaseRoot.resolve();
    releaseNewRoot.resolve();
  }
});
