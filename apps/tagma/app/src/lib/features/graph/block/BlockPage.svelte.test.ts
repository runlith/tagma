// @vitest-environment jsdom
import type { Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { makeRouter, makeStorage } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { waitUntil } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
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
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Visits } from '$lib/features/workspace/Visits.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import { TranslationLayer } from '$lib/features/graph/translation/layer.js';
import { LinksPlacement } from './LinksPlacement.svelte.js';
import BlockPage from './BlockPage.svelte';

await loadOperations();

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

const row = (
  name: string,
  parentName: string | null,
  ord: number,
  title: string,
  tags: readonly string[] = [],
  fields = {},
): TreeBlock => ({
  name,
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
  refsOut: [],
  refsIn: [],
  restingIn: { edges: [], refs: [] },
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
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/op/read_tree') return json({ status: 'ok', blocks: [...rows.values()] });
    if (path === '/api/op/ready_work') return json({ status: 'ok', tasks: [], shown: 0, total: 0, next: null, complete: true });
    if (path === '/api/op/list_trash') return json({ status: 'ok', blocks: [] });
    if (path === '/api/op/read_block') {
      const { blockIds } = (await request.json()) as { blockIds: string[] };
      return json({ status: 'ok', reads: blockIds.map((name) => read(rows.get(name)!)) });
    }
    throw new Error(`Unexpected request ${request.url}`);
  };
  const frames: ((frame: GraphFrame) => void)[] = [];
  const failures: unknown[] = [];
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
      Layer.of(Workspace, { active: project, contextProject: project, find: () => null, nameOf: async () => 'tagma' } as never),
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
  await waitUntil(() => titleOf(main) === 'Agents' && main.querySelector(`a[data-block="${MODULE}"]`) !== null);
  const side = app.draw(BlockSeat as never, { placed: { projectId: 1, branch: null, name: MODULE, diff: null } });
  await waitUntil(() => titleOf(side) === 'Agent threads');
  flushSync();

  expect(readState.trailOf).toEqual([MODULE, PART]);

  const renamed = { ...rows.get(PART)!, title: 'Agents and teams', updatedAt: LATER };
  rows.set(PART, renamed);
  for (const frame of frames)
    frame({ type: 'change', projectId: 1, events: [], sessions: [], blocks: [renamed], edges: [], refs: [], ready: [], trash: [] });
  await waitUntil(() => titleOf(main) === 'Agents and teams');
  flushSync();

  expect(readState.trailOf).toEqual([MODULE, PART]);
  expect(readState.isUnread(PART, LATER)).toBe(false);
  expect(titleOf(side)).toBe('Agent threads');
  expect(failures).toEqual([]);
});

test('a project root opened in a tab from another project lists its parts beside the window project’s Knowledge page', async () => {
  const HONO = 2;
  const HONO_ROOT = 'e0000000';
  const HONO_PART = 'e0000001';
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
      return json({ status: 'ok', reads: blockIds.map((name) => read(rows.get(name)!)) });
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
      Layer.of(Workspace, {
        active: project,
        contextProject: project,
        contextId: project.id,
        find: () => null,
        nameOf: async () => 'tagma',
      } as never),
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

  const lists = (target: HTMLElement, name: string): boolean => target.querySelector(`a[data-block="${name}"]`) !== null;
  await waitUntil(() => lists(knowledge, PART) && lists(ownRoot, PART) && foreignRoot.textContent?.includes('Add block') === true);
  flushSync();

  expect(lists(foreignRoot, HONO_PART)).toBe(true);
  expect(failures).toEqual([]);
});
