// @vitest-environment jsdom
import type { Block, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { afterEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';

import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';

await loadCatalog();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

const EARLIER = '2026-09-05T00:00:00Z';
const NOW = '2026-09-05T01:00:00Z';
const LATER = '2026-09-05T02:00:00Z';

const block = (name: string, over: Partial<TreeBlock> = {}): TreeBlock => ({
  name,
  projectId: 1,
  parentName: null,
  ord: 0,
  tags: ['task'],
  fields: { status: 'open' },
  actions: { moves: [], slots: [], offers: [], revision: 'test' },
  title: name,
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: EARLIER,
  updatedAt: NOW,
  ...over,
});

const detail = (name: string, over: Partial<TreeBlock> = {}): Block => ({ ...block(name, over), body: '' });

const change = (over: Partial<Extract<GraphFrame, { type: 'change' }>> = {}): GraphFrame => ({
  type: 'change',
  projectId: 1,
  events: [],
  sessions: [],
  blocks: [],
  edges: [],
  refs: [],
  ready: [],
  trash: [],
  ...over,
});

type Server = {
  tree: TreeBlock[];
  ready: Block[];
  trash: Block[];
  gate?: PromiseWithResolvers<void>;
  asked?: PromiseWithResolvers<void>;
};

let server: Server = { tree: [], ready: [], trash: [] };
const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.pathname === '/api/op/read_tree') {
    server.asked?.resolve();
    if (server.gate) await server.gate.promise;
    return json({ status: 'ok', blocks: server.tree });
  }
  if (url.pathname === '/api/op/ready_work') {
    const { cursor } = (await request.json()) as { cursor?: string };
    const start = Number(cursor ?? 0);
    const tasks = server.ready.slice(start, start + 100).map((task) => ({ ...task, author: null }));
    const next = start + tasks.length < server.ready.length ? String(start + tasks.length) : null;
    return json({ status: 'ok', tasks, shown: tasks.length, total: server.ready.length, next, complete: true });
  }
  if (url.pathname === '/api/op/list_trash') return json({ status: 'ok', blocks: server.trash });
  return json([]);
};

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  server = { tree: [], ready: [], trash: [] };
});

function stand(holds: Partial<Server> = {}) {
  server = { tree: [], ready: [], trash: [], ...holds };

  let push: ((frame: GraphFrame) => void) | undefined;
  const failures: unknown[] = [];
  const live = {
    hold: (_subscribe: unknown, frame: (frame: GraphFrame) => void) => {
      push = frame;
      return { unsubscribe: () => (push = undefined) };
    },
  };

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
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, live as never),
      Layer.of(TagCatalog, testTagCatalog()),
      Failure.of((error) => {
        failures.push(error);
      }),
    ),
    { at: { projectId: 1, branch: 'main' } },
  );

  const mounted = app;
  return {
    failures,
    tree: mounted.app.resolve(ProjectTree, mounted.app.scopeOf('graph')),
    send(frame: GraphFrame): void {
      if (!push) throw new Error('The graph holds no live subscription');
      push(frame);
    },
  };
}

test('a resync reads the whole graph again: the rows, the frontier, the trash roots and the order derived from them', async () => {
  const world = stand({
    tree: [block('root'), block('second', { parentName: 'root', ord: 2 }), block('first', { parentName: 'root', ord: 1 })],
    ready: [detail('first')],
    trash: [detail('dropped')],
  });
  expect(world.tree.loaded).toBe(false);

  world.send({ type: 'resync' });

  await waitUntil(() => world.tree.loaded);
  expect([...world.tree.blocks.keys()].sort()).toEqual(['first', 'root', 'second']);
  expect(world.tree.children('root')).toEqual(['first', 'second']);
  expect(world.tree.rootName).toBe('root');
  expect([...world.tree.readyNames]).toEqual(['first']);
  expect(world.tree.trashRoots.map((row) => row.name)).toEqual(['dropped']);
  expect(world.failures).toEqual([]);
});

test('a resync gathers every ready page before replacing the frontier', async () => {
  const world = stand({
    tree: [block('root')],
    ready: Array.from({ length: 101 }, (_, index) => detail(`task-${index}`)),
  });
  world.send({ type: 'resync' });
  await waitUntil(() => world.tree.loaded);
  expect(world.tree.readyNames.size).toBe(101);
  expect(world.tree.readyNames.has('task-100')).toBe(true);
  expect(world.failures).toEqual([]);
});

test('a row older than the one already held is dropped, a newer one lands, and a deleted row leaves the live map', async () => {
  const world = stand({ tree: [block('root'), block('task', { parentName: 'root', title: 'as it stands' })] });
  world.send({ type: 'resync' });
  await waitUntil(() => world.tree.loaded);

  world.send(change({ blocks: [block('task', { title: 'stale', updatedAt: EARLIER })] }));
  expect(world.tree.block('task')?.title).toBe('as it stands');

  world.send(change({ blocks: [block('task', { title: 'newer', updatedAt: LATER })] }));
  expect(world.tree.block('task')?.title).toBe('newer');

  world.send(change({ blocks: [block('task', { deletedAt: LATER, updatedAt: LATER })], trash: [block('task')] }));
  expect(world.tree.block('task')).toBeUndefined();
  expect(world.tree.trashRoots.map((row) => row.name)).toEqual(['task']);
});

test('a change replaces the frontier, the trash and the sibling order only where its blocks reach', async () => {
  const world = stand({
    tree: [
      block('root'),
      block('first', { parentName: 'root', ord: 1 }),
      block('second', { parentName: 'root', ord: 2 }),
      block('shelf', { parentName: 'root', ord: 3 }),
    ],
    ready: [detail('first'), detail('second')],
    trash: [detail('orphan', { parentName: 'shelf', deletedAt: EARLIER }), detail('loose', { deletedAt: EARLIER })],
  });
  world.send({ type: 'resync' });
  await waitUntil(() => world.tree.loaded);

  world.send(
    change({
      blocks: [
        block('first', { parentName: 'root', ord: 4, fields: { status: 'in_work' }, updatedAt: LATER }),
        block('shelf', { parentName: 'root', ord: 3, deletedAt: LATER, updatedAt: LATER }),
      ],
      trash: [block('shelf', { parentName: 'root', deletedAt: LATER })],
    }),
  );

  expect([...world.tree.readyNames]).toEqual(['second']);
  expect(world.tree.children('root')).toEqual(['second', 'first']);
  expect(world.tree.trashRoots.map((row) => row.name)).toEqual(['shelf', 'loose']);
});

test('a commit landing while the whole-project read is in flight survives it', async () => {
  const world = stand({
    tree: [block('root')],
    gate: Promise.withResolvers<void>(),
    asked: Promise.withResolvers<void>(),
  });

  world.send({ type: 'resync' });
  await server.asked?.promise;

  world.send(change({ blocks: [block('landed', { parentName: 'root', updatedAt: LATER })], ready: ['landed'] }));
  expect(world.tree.block('landed')).toBeUndefined();

  server.gate?.resolve();

  await waitUntil(() => world.tree.block('landed')?.name === 'landed');
  expect([...world.tree.readyNames]).toEqual(['landed']);
  expect(world.tree.rootName).toBe('root');
  expect(world.failures).toEqual([]);
});
