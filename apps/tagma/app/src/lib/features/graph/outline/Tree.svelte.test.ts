// @vitest-environment jsdom
import type { Block, TreeBlock, WrittenBlock } from '@tagma/server/graph/contract/wire/rows';
import type { Vocabulary } from '@tagma/server/graph/contract/wire/tags/table';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { Cache } from '@runlith/query/repo';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { HiddenStates } from '$lib/features/graph/HiddenStates.svelte.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';
import { SessionsRepo } from '$lib/features/graph/SessionsRepo.js';
import { blockLink } from '$lib/features/graph/links.js';
import { ProjectTree } from '$lib/features/graph/ProjectTree.svelte.js';
import { ReadState } from '$lib/features/graph/ReadState.svelte.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { ThreadWork } from '$lib/features/graph/ThreadWork.svelte.js';
import { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Link } from '$lib/features/opening/Link.js';
import { linkWithin } from '$lib/features/opening/linkTarget.js';
import type { Opening } from '$lib/features/opening/Opening.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import Tree from './Tree.svelte';

await loadOperations();

const AT = '2026-09-05T00:00:00Z';

const VOCABULARY: Vocabulary = {
  catalogs: [],
  installed: [],
  findings: [],
  tags: [],
  unreadable: [],
  actions: {},
  fieldNames: {},
  forms: {},
  laws: {},
  revision: { format: 2, revision: '' },
};

const row = (name: string, parentName: string | null, ord: number, title: string): WrittenBlock => ({
  name,
  projectId: 1,
  parentName,
  ord,
  tags: [],
  fields: {},
  actions: { moves: [], slots: [], offers: [], revision: '' },
  title,
  superseded: false,
  blocked: false,
  building: false,
  answered: false,
  deletedAt: null,
  createdAt: AT,
  updatedAt: AT,
  body: '',
});

function json(body: unknown): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { headers: { 'content-type': 'application/json' } }), {
    arrayBuffer: async () => buffer,
  });
}

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

test('a row opens its block instead of editing; F2 starts the edit, Enter starts the next row in edit, and Tab keeps its typed title', async () => {
  const rows = new Map<string, WrittenBlock>([
    ['root', row('root', null, 0, 'Project')],
    ['a1b2c3d4', row('a1b2c3d4', 'root', 1, 'Plan')],
  ]);
  const titled: { blockId: string; title?: string }[] = [];
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/api/op/read_tree') return json({ status: 'ok', blocks: [...rows.values()] satisfies TreeBlock[] });
    if (path === '/api/op/ready_work') return json({ status: 'ok', tasks: [], shown: 0, total: 0, next: null, complete: true });
    if (path === '/api/op/list_trash') return json({ status: 'ok', blocks: [] satisfies Block[] });
    if (path === '/api/op/update_block') {
      const asked = (await request.json()) as { blockId: string; title?: string; parentId?: string; ord?: number };
      if (asked.title !== undefined) titled.push({ blockId: asked.blockId, title: asked.title });
      const current = rows.get(asked.blockId)!;
      const next = {
        ...current,
        title: asked.title ?? current.title,
        parentName: asked.parentId ?? current.parentName,
        ord: asked.ord ?? current.ord,
      };
      rows.set(next.name, next);
      return json({ status: 'ok', block: next });
    }
    if (path === '/api/op/apply_batch') {
      rows.set('e5f6a7b8', row('e5f6a7b8', 'root', 2, ''));
      return json({ status: 'ok', overview: '', ids: { n: 'e5f6a7b8' } });
    }
    throw new Error(`Unexpected request ${request.url}`);
  };

  const tags = testTagCatalog(1, async () => VOCABULARY);
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
      Layer.of(Live, { hold: () => ({ unsubscribe: () => undefined }) } as never),
      Layer.of(TagCatalog, tags),
      Layer.of(ReadState, { isUnread: () => false } as never),
      Layer.of(SessionRegistry, { writerOf: () => null } as never),
      Layer.of(ThreadWork, {} as never),
      Layer.of(Notices, { undoable: () => undefined } as never),
      Layer.of(Workspace, { find: () => null } as never),
      Failure.of((error) => void failures.push(error)),
    ),
    { at: { projectId: 1, branch: null } },
  );
  await tags.read(1);
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
  );
  screen.load();

  const opened: Link[] = [];
  const opening = {
    knows: () => true,
    modified: () => false,
    how: () => 'beside',
    open: async (link: Link) => void opened.push(link),
    menu: () => undefined,
  } as unknown as Opening;
  const target = app.draw(Tree as never, { store: screen });
  const release = linkWithin(opening, 'a[data-block]', (element) => blockLink({ name: element.dataset['block'] ?? '' }))(target);
  flushSync();

  const link = (name: string): HTMLAnchorElement => target.querySelector<HTMLAnchorElement>(`a[data-block="${name}"]`)!;
  const titleOf = (name: string): HTMLElement => link(name).closest('.block-row')!.querySelector<HTMLElement>('[data-placeholder]')!;
  const editable = (element: Element): boolean => element.getAttribute('contenteditable') === 'true';
  const editing = (): string | null => {
    const focused = document.activeElement;
    return focused !== null && editable(focused)
      ? (focused.closest('.block-row')?.querySelector<HTMLElement>('a[data-block]')?.dataset['block'] ?? null)
      : null;
  };

  try {
    await waitUntil(() => link('a1b2c3d4') !== null);

    titleOf('a1b2c3d4').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    link('a1b2c3d4').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flushSync();
    expect(opened).toEqual([{ kind: 'block', target: { name: 'a1b2c3d4' }, from: undefined }]);
    expect(editable(titleOf('a1b2c3d4'))).toBe(false);
    expect(editing()).toBeNull();

    link('a1b2c3d4').focus();
    link('a1b2c3d4').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    flushSync();
    expect(editing()).toBe('a1b2c3d4');

    titleOf('a1b2c3d4').textContent = 'Plan the week';
    titleOf('a1b2c3d4').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitUntil(() => editing() === 'e5f6a7b8');
    expect(titled).toContainEqual({ blockId: 'a1b2c3d4', title: 'Plan the week' });

    titleOf('e5f6a7b8').textContent = 'Draft';
    titleOf('e5f6a7b8').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await waitUntil(() => rows.get('e5f6a7b8')?.parentName === 'a1b2c3d4');
    await waitUntil(() => editing() === 'e5f6a7b8');
    expect(titleOf('e5f6a7b8').textContent).toBe('Draft');
    titleOf('e5f6a7b8').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(editing()).toBeNull();
    expect(titled.filter((entry) => entry.blockId === 'e5f6a7b8').map((entry) => entry.title)).toEqual(['Draft']);
    expect(opened).toHaveLength(1);
    expect(failures).toEqual([]);
  } finally {
    if (typeof release === 'function') release();
  }
});
