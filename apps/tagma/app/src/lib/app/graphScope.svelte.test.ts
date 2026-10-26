// @vitest-environment jsdom
import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Cache, Repo } from '@runlith/query/repo';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test, vi } from 'vitest';

import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
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
import { testDoor } from '$lib/wire/testing.js';
import { loadOperations } from '$lib/wire/operation.js';

await loadOperations();

function json(body: unknown): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { headers: { 'content-type': 'application/json' } }), {
    arrayBuffer: async () => buffer,
  });
}

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
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z',
  ...over,
});

const session = (id: number) => ({ id, harness: 'tagma', key: `thread-${id}`, thread: `thread-${id}`, createdAt: '2026-09-05T00:00:00Z' });

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

type Held = { tree: TreeBlock[]; sessions: ReturnType<typeof session>[] };

type Subscription = { readonly branch: string; readonly frame: (frame: GraphFrame) => void; open: boolean };

let graphs = new Map<string, Held>();
const held = (url: URL): Held => graphs.get(url.searchParams.get('branch') ?? '') ?? { tree: [], sessions: [] };
const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(new Request(input, init).url);
  if (url.pathname === '/api/op/read_tree') return json({ status: 'ok', blocks: held(url).tree });
  if (url.pathname === '/api/op/list_sessions') {
    const sessions = held(url).sessions;
    return json({ status: 'ok', sessions, shown: sessions.length, total: sessions.length, next: null });
  }
  return json([]);
};

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  graphs = new Map();
});

function stand(branch: string, server: Record<string, Held>) {
  graphs = new Map(Object.entries(server));

  const subscriptions: Subscription[] = [];
  const failures: unknown[] = [];

  const live = {
    hold: (subscribe: (client: never) => unknown, frame: (frame: GraphFrame) => void) => {
      const aim = subscribe({ 'graph.subscribe': (params: unknown) => params } as never) as {
        projectId: number;
        branch?: string;
      };
      const subscription: Subscription = { branch: aim.branch ?? '', frame, open: true };
      subscriptions.push(subscription);
      return {
        unsubscribe: () => {
          subscription.open = false;
        },
      };
    },
  };

  app = mountShell(
    Layer.mergeAll(
      Cache.of({ defaultOptions: { queries: { retry: false } } }),
      GraphDoor,
      BlocksRepo,
      JournalRepo,
      SelectionRepo,
      SessionsRepo,
      GraphFeed,
      ProjectTree,
      SessionRegistry,
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, live as never),
      Layer.of(TagCatalog, testTagCatalog()),
      Failure.of((error) => {
        failures.push(error);
      }),
    ),
    { at: { projectId: 1, branch } },
  );

  const mounted = app;
  return {
    app: mounted,
    failures,
    subscriptions,
    graph: (name: string): Held => graphs.get(name) as Held,
    push(name: string, frame: GraphFrame): void {
      const subscription = subscriptions.find((standing) => standing.branch === name && standing.open);
      if (!subscription) throw new Error(`No live subscription stands on "${name}"`);
      subscription.frame(frame);
    },
    answersUnder(prefix: string): string[] {
      return mounted.app
        .resolve(Cache)
        .getQueryCache()
        .getAll()
        .map((query) => String(query.queryKey[0]))
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length));
    },
  };
}

test('the branch the address moves to is a new scope: the old one is finalized, its subscription ends and its answers go with it', async () => {
  const world = stand('main', {
    main: { tree: [block('main-root')], sessions: [] },
    next: { tree: [block('next-root')], sessions: [] },
  });
  const before = world.app.app.hold('graph', { projectId: 1, branch: 'main' });
  const reader = world.app.app.resolve(BlocksRepo, before.scope);
  expect((await reader.tree.loadOrThrow())?.map((row) => row.name)).toEqual(['main-root']);
  expect(world.answersUnder(Repo.prefixOf(before.scope))).toContain('blocks.tree');
  before.release();

  world.app.place({ projectId: 1, branch: 'next' });
  await flush();

  const after = world.app.app.scopeOf('graph');
  expect([before.scope.name, after.name]).toEqual(['project:1/graph:1:main', 'project:1/graph:1:next']);
  expect(before.scope.closed).toBe(true);
  expect(world.subscriptions.map((standing) => [standing.branch, standing.open])).toEqual([
    ['main', false],
    ['next', true],
  ]);

  expect(world.answersUnder(Repo.prefixOf(before.scope))).toEqual([]);
  const now = world.app.app.resolve(BlocksRepo, after);
  expect((await now.tree.loadOrThrow())?.map((row) => row.name)).toEqual(['next-root']);
  expect(world.answersUnder(Repo.prefixOf(after))).toContain('blocks.tree');
  expect(world.failures).toEqual([]);
});

test('a commit on one branch reaches that branch’s tree and no other', async () => {
  const world = stand('main', { main: { tree: [], sessions: [] }, next: { tree: [], sessions: [] } });
  const here = world.app.app.hold('graph', { projectId: 1, branch: 'main' });
  const there = world.app.app.hold('graph', { projectId: 1, branch: 'next' });
  const mine = world.app.app.resolve(ProjectTree, here.scope);
  const other = world.app.app.resolve(ProjectTree, there.scope);

  world.push('main', change({ blocks: [block('landed', { title: 'A block on main' })], ready: ['landed'] }));

  expect(mine.block('landed')?.title).toBe('A block on main');
  expect([...mine.readyNames]).toEqual(['landed']);
  expect(other.block('landed')).toBeUndefined();
  expect([...other.readyNames]).toEqual([]);

  here.release();
  there.release();
});

test('a change frame invalidates the graph’s own answers and the reader watching them refetches', async () => {
  const world = stand('main', { main: { tree: [block('main-root')], sessions: [] } });
  const reader = world.app.app.resolve(BlocksRepo, world.app.app.scopeOf('graph'));

  let seen: readonly TreeBlock[] | undefined;
  const stop = $effect.root(() => {
    $effect(() => {
      seen = reader.tree.data;
    });
  });

  try {
    await vi.waitFor(() => expect(seen?.map((row) => row.name)).toEqual(['main-root']));
    world.graph('main').tree = [block('main-root'), block('landed')];
    world.push('main', change({ blocks: [block('landed')] }));
    await vi.waitFor(() => expect(seen?.map((row) => row.name)).toEqual(['main-root', 'landed']));
  } finally {
    stop();
  }
});

test('a session id belongs to one graph: the registry that met it names the writer, the graph beside it has not, and nothing signed is the operator', async () => {
  const world = stand('main', {
    main: { tree: [], sessions: [session(7)] },
    next: { tree: [], sessions: [] },
  });
  const here = world.app.app.hold('graph', { projectId: 1, branch: 'main' });
  const there = world.app.app.hold('graph', { projectId: 1, branch: 'next' });
  const mine = world.app.app.resolve(SessionRegistry, here.scope);
  const other = world.app.app.resolve(SessionRegistry, there.scope);

  await vi.waitFor(() => expect(mine.writerOf(7)?.key).toBe('thread-7'));
  expect(other.writerOf(7)).toBeUndefined();
  expect(mine.writerOf(null)).toBeNull();
  expect(world.failures).toEqual([]);

  here.release();
  there.release();
});
