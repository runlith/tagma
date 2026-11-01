// @vitest-environment jsdom
import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
import { Layer } from '@runlith/layer/Layer';
import { makeStorage } from '@runlith/layer/testing';
import { Cache } from '@runlith/query/repo';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, soloWorkspace, testTagCatalog, type TestApp } from '$lib/app/testing.js';
import { AreaFrame } from '$lib/app/panes/AreaFrame.svelte.js';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { TranslationLayer } from '$lib/features/graph/translation/layer.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { Sidebar } from './Sidebar.svelte.js';
import SidebarView from './Sidebar.svelte';

await loadCatalog();
let app: TestApp | undefined;
afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

const first = '0199000000007000800000001234abcd';
const second = '1199000000007000800000001234abcd';
const row = (identity: string, rowKey: number): TreeBlock => ({
  identity,
  rowKey,
  name: '1234abcd',
  projectId: 1,
  parentName: null,
  parentIdentity: null,
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
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:00Z',
});

test('recent visits merge a legacy name with its full identity and keep colliding rows distinct', async () => {
  const a = row(first, 1);
  const b = row(second, 2);
  const storage = makeStorage();
  storage.setItem('tagma.visited', JSON.stringify({ '1': ['1234abcd'] }));
  const answer = async (input: RequestInfo | URL) => {
    const path = new URL(new Request(input).url).pathname;
    const body =
      path === '/api/op/read_tree'
        ? { blocks: [a] }
        : path === '/api/op/ready_work'
          ? { tasks: [], shown: 0, total: 0, next: null, complete: true }
          : { blocks: [] };
    return new Response(JSON.stringify({ status: 'ok', ...body }), { headers: { 'content-type': 'application/json' } });
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
      GraphSelection,
      ReaderMarks,
      ReadState,
      HiddenStates,
      Sidebar,
      TranslationLayer,
      Seams,
      AreaFrame,
    ),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(Live, { hold: () => ({ unsubscribe: () => undefined }) } as never),
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(SessionRegistry, { writerOf: () => null } as never),
      Layer.of(Workspace, soloWorkspace({ contextProject: { id: 1, name: 'home' } })),
    ),
    { at: { projectId: 1, branch: null }, storage },
  );
  const graph = app.app.scopeOf('graph');
  const tree = app.app.resolve(ProjectTree, graph);
  const visits = app.app.resolve(ReadState, graph);
  await tree.reload();
  visits.visited(first);
  const sidebar = app.draw(SidebarView as never);
  const shown = () => [...sidebar.querySelectorAll('a[data-block]')].map((link) => link.getAttribute('data-block'));
  await vi.waitFor(() => expect(shown()).toEqual([first]));
  tree.writeFresh(b);
  visits.visited(second);
  await vi.waitFor(() => expect(shown()).toEqual([second, first]));
});
