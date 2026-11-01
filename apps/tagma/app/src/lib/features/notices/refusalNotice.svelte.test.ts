// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';

import { NoticesLayer } from '$lib/features/notices/layer.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';

await loadCatalog();

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json' } });
}

let refuse: () => Response = () => json([]);
const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(new Request(input, init).url);
  return url.pathname === '/api/op/read_tree'
    ? refuse()
    : json({ status: 'ok', blocks: [], tasks: [], shown: 0, total: 0, next: null, complete: true });
};

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  refuse = () => json({ status: 'ok', blocks: [] });
});

function stand(answerTree: () => Response) {
  refuse = answerTree;

  let push: ((frame: GraphFrame) => void) | undefined;
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
      NoticesLayer,
    ),
    Layer.mergeAll(Layer.of(Door, testDoor(answer)), Layer.of(Live, live as never), Layer.of(TagCatalog, testTagCatalog())),
  );

  const mounted = app;
  mounted.app.resolve(ProjectTree, mounted.app.scopeOf('graph'));
  return {
    notices: mounted.app.resolve(Notices),
    resync(): void {
      if (!push) throw new Error('The graph holds no live subscription');
      push({ type: 'resync' });
    },
  };
}

test('a gate refusal met by a background graph read lands in the error list with the server’s code and reason, and raises no card', async () => {
  const gate = {
    code: 'unknown-project',
    reason: 'No project answers to “7”.',
    unblock: ['Name a project the graph holds'],
    words: { text: 'No such project.' },
  };
  const world = stand(() => json(gate, { status: 409 }));

  world.resync();

  await waitUntil(() => world.notices.faults.length > 0);
  expect(world.notices.faults).toHaveLength(1);
  expect(world.notices.faults[0]).toMatchObject({ title: gate.code, body: gate.reason, count: 1 });
  expect(world.notices.list).toEqual([]);
});

test('a failure with no gate behind it lands in the error list, counted once per repeat, and raises no card', async () => {
  const world = stand(() => new Response('not json at all', { status: 502 }));

  world.resync();
  await waitUntil(() => world.notices.faults.length > 0);
  expect(world.notices.faults).toHaveLength(1);
  expect(world.notices.faults[0]?.body).toContain('/api/op/read_tree');

  world.resync();
  await waitUntil(() => (world.notices.faults[0]?.count ?? 0) >= 2);
  expect(world.notices.faults[0]?.count).toBe(2);
  expect(world.notices.faults).toHaveLength(1);
  expect(world.notices.list).toEqual([]);
});
