// @vitest-environment jsdom
import type { Edge, Ref, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { makeRouter } from '@runlith/layer/testing';
import { Scope } from '@runlith/layer/Scope';
import { Cache } from '@runlith/query/repo';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, testTagCatalog, type TestApp } from '$lib/app/testing.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type GraphFrame } from '$lib/wire/Live.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import GraphView from './GraphView.svelte';
import GraphPage from './Page.svelte';

await loadCatalog();

const AT = '2026-10-28T10:00:00Z';
const ROOT = '000000000000000000000000a0000000';
const FIRST = '019900000000700080000000cafe0001';
const SECOND = `${FIRST.slice(0, -12)}1${FIRST.slice(-11)}`;
const THIRD = '219900000000700080000000cafe0002';

const row = (identity: string, rowKey: number, parentIdentity: string | null): TreeBlock => ({
  name: identity.slice(-8),
  identity,
  rowKey,
  projectId: 1,
  parentName: parentIdentity?.slice(-8) ?? null,
  parentIdentity,
  ord: rowKey,
  tags: [],
  fields: {},
  actions: { moves: [], slots: [], offers: [], revision: '' },
  title: `Block ${rowKey}`,
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: AT,
  updatedAt: AT,
});

let app: TestApp | undefined;
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(async () => {
  await app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (fonts === undefined) Reflect.deleteProperty(document, 'fonts');
  else Object.defineProperty(document, 'fonts', fonts);
});

test('the spatial map draws the edge and reference of two blocks with the same short name', async () => {
  const rows = [row(ROOT, 1, null), row(FIRST, 2, ROOT), row(SECOND, 3, ROOT), row(THIRD, 4, ROOT)];
  const edges: Edge[] = [
    {
      fromName: FIRST.slice(-8),
      toName: THIRD.slice(-8),
      fromIdentity: FIRST,
      toIdentity: THIRD,
      fromRowKey: 2,
      toRowKey: 4,
      kind: 'relates',
      createdBySessionId: null,
      createdAt: AT,
    },
  ];
  const refs: Ref[] = [
    {
      fromName: SECOND.slice(-8),
      toName: THIRD.slice(-8),
      fromIdentity: SECOND,
      toIdentity: THIRD,
      fromRowKey: 3,
      toRowKey: 4,
    },
  ];
  let edgeRead = false;
  let refRead = false;
  let receive: ((frame: GraphFrame) => void) | undefined;
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/op/read_block') {
      const { blockIds } = (await request.json()) as { blockIds: string[] };
      if (blockIds[0] !== SECOND.slice(-12)) throw new Error(`Unexpected block ${blockIds[0]}`);
      return new Response(
        JSON.stringify({
          status: 'ok',
          reads: [
            {
              ...rows[2],
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
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    const body =
      path === '/api/op/read_tree'
        ? { status: 'ok', blocks: rows }
        : path === '/api/op/ready_work'
          ? { status: 'ok', tasks: [], shown: 0, total: 0, next: null, complete: true }
          : path === '/api/op/list_trash'
            ? { status: 'ok', blocks: [] }
            : path === '/api/op/read_edges'
              ? ((edgeRead = true), { status: 'ok', edges })
              : path === '/api/op/read_refs'
                ? ((refRead = true), { status: 'ok', refs })
                : (() => {
                    throw new Error(`Unexpected request ${path}`);
                  })();
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const lines = vi.fn();
  const dashes: number[][] = [];
  const context = new Proxy(
    {
      lineTo: lines,
      setLineDash: (dash: number[]) => dashes.push(dash),
      measureText: () => ({ width: 10 }),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => undefined) },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => (frames.push(frame), frames.length));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const tags = testTagCatalog();
  tags.served = true;
  const failures: unknown[] = [];
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
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, {
        hold: (_open: unknown, frame: (value: GraphFrame) => void) => {
          receive = frame;
          return { unsubscribe() {} };
        },
      } as never),
      Layer.of(TagCatalog, tags),
      Layer.of(GraphSelection, { name: null } as never),
      Layer.of(Notices, { background: (error: unknown) => failures.push(error) } as never),
      Layer.of(Workspace, { active: { name: 'test' } } as never),
      Failure.of((error) => failures.push(error)),
    ),
    {
      at: { projectId: 1, branch: null },
      router: makeRouter({
        routeId: '/[project]/graph/[[id]]',
        params: { project: 'test', id: SECOND.slice(-12) },
        url: new URL(`https://tagma.test/test/graph/${SECOND.slice(-12)}`),
      }),
    },
  );
  const graph = app.app.scopeOf('graph');
  const tree = app.app.resolve(ProjectTree, graph);
  await tree.reload();
  const screen = new TreeScreen(
    tree,
    app.app.resolve(BlocksRepo, graph),
    app.get(HiddenStates),
    tags,
    app.get(Notices),
    app.get(Failure),
    app.storage,
    Scope.make(),
    1,
    'graph',
  );
  screen.load();
  app.draw(GraphView as never, { store: screen });
  await vi.waitFor(() => expect(edgeRead && refRead).toBe(true));
  await flush();
  const draw = frames.shift();
  expect(draw).toBeDefined();
  draw?.(0);
  expect(lines).toHaveBeenCalledTimes(5);
  expect(dashes.some((dash) => dash.length === 2)).toBe(true);

  const departed = { ...rows[1]!, identity: '319900000000700080000000cafe0001', deletedAt: AT };
  receive?.({
    type: 'change',
    projectId: 1,
    events: [],
    sessions: [],
    blocks: [departed],
    edges: [],
    refs: [],
    ready: [],
    readyIdentities: [],
    trash: [departed],
  });
  await flush();
  lines.mockClear();
  dashes.length = 0;
  frames.shift()?.(16);
  expect(lines).toHaveBeenCalledTimes(3);
  expect(dashes.some((dash) => dash.length === 2)).toBe(true);
  const scoped = app.draw(GraphPage as never, {});
  await vi.waitFor(() => expect(scoped.textContent).toContain('Block 3'));
  const trashed = { ...rows[2]!, deletedAt: AT };
  receive?.({
    type: 'change',
    projectId: 1,
    events: [],
    sessions: [],
    blocks: [trashed],
    edges: [],
    refs: [],
    ready: [],
    readyIdentities: [],
    trash: [trashed],
  });
  await vi.waitFor(() => expect(scoped.textContent).toContain('Restore'));
  expect(failures).toEqual([]);
});
