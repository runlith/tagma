// @vitest-environment jsdom
import PanelRight from '@lucide/svelte/icons/panel-right';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { makeRouter } from '@runlith/layer/testing';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Overlays } from '$lib/app/overlays.js';
import TestHost from '$lib/app/TestHost.svelte';
import { testAddresses, testAddressing } from '$lib/app/testing.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import type { Link, LinkPlace } from '$lib/features/opening/Link.js';
import LinkMenu from '$lib/features/opening/LinkMenu.svelte';
import { LinkRegistry } from '$lib/features/opening/LinkRegistry.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ThreadNames, type OwnerWords } from '$lib/shared/threads/Names.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { TileRung } from '$lib/features/workspace/TileRung.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { createHeadlessMarkdownEditor } from '@runlith/markdown-editor/codec';
import { createMarkdownEditorExtensions } from '@runlith/markdown-editor/extensions';
import { bodyEditorExtensions } from './bodyEditor.js';
import Body from './Body.svelte';

const thread = '01a16dee-2ab6-7368-a8dd-8e28322636c7';
const missing = '01a16dee-2ab6-7368-a8dd-000000000000';

test('the block body renders thread references, follows live names and opens their home without changing the source', async () => {
  const words = $state<{ current: OwnerWords | undefined }>({ current: undefined });
  const opened: Link[] = [];
  const written: string[] = [];
  const app = mountApp(
    Layer.mergeAll(Overlays, testAddressing),
    Layer.mergeAll(
      Layer.of(Router, makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') })),
      Layer.of(ThreadNames, new ThreadNames((id) => (id === thread ? words.current : null))),
      Layer.of(Notices, {
        background: (error: unknown) => {
          throw error;
        },
      } as never),
      Layer.of(BlockTitles, { answered: 0, peer: () => ({ title: 'Notes', project: 'runlith' }) } as never),
      Layer.of(Opening, {
        knows: () => true,
        modified: () => false,
        how: () => 'beside',
        open: async (link: Link) => void opened.push(link),
        menu: () => undefined,
        tip: () => ({ text: null }),
      } as never),
    ),
    {
      ladder: [TileRung, ProjectRung, GraphRung],
      at: { tile: { tileId: 5 }, project: { projectId: 5 }, graph: { projectId: 5, branch: null } },
    },
  );
  const target = document.createElement('div');
  const host = mount(TestHost, {
    target,
    props: {
      app: app.app,
      view: Body as never,
      props: {
        body: `В [[${thread}|исходном треде]] run начался; [[${thread}]], [[${missing}|удалённый]] и [[5b386d76]].`,
        store: {
          rootName: '24e6b6b0',
          blocks: new Map(),
          block: () => undefined,
          setBody: async (_name: string, body: string) => void written.push(body),
        },
      },
    },
  });
  try {
    await waitUntil(() => target.querySelectorAll(`[data-bracket-ref-target="${thread}"]`).length === 2);
    const editor = target.querySelector('.ProseMirror');
    const labelled = target.querySelector<HTMLElement>(`[data-bracket-ref-target="${thread}"]`)!;
    expect(labelled.textContent).toBe('исходном треде');
    expect(target.querySelector('.ProseMirror')?.textContent).toBe(`В исходном треде run начался; ${thread}, удалённый и Notes.`);

    words.current = { label: 'Source run', archived: false, harness: false, home: 'shop', projectId: 7 };
    flushSync();
    await waitUntil(
      () => target.querySelector('.ProseMirror')?.textContent === 'В исходном треде run начался; Source run, удалённый и Notes.',
    );
    expect(target.querySelector('.ProseMirror')).toBe(editor);
    expect(target.querySelector(`[data-bracket-ref-target="${thread}"]`)).toBe(labelled);
    labelled.click();
    expect(opened).toEqual([{ kind: 'thread', target: { threadId: thread, projectId: 7 }, from: undefined }]);
    target.querySelector<HTMLElement>(`[data-bracket-ref-target="${missing}"]`)!.click();
    expect(opened).toHaveLength(1);
    target.querySelector<HTMLElement>('[data-bracket-ref-target="5b386d76"]')!.click();
    expect(opened[1]).toEqual({ kind: 'block', target: { name: '5b386d76' }, from: undefined });
  } finally {
    await unmount(host);
    await app.unmount();
  }
  expect(written).toEqual([]);
});

test('the link menu opened by a right click on a reference in the body stays open when the button is released', async () => {
  const place: LinkPlace<unknown> = { words: 'block', icon: PanelRight, open: () => undefined };
  const kinds = new LinkRegistry([{ links: [{ kind: 'block', what: () => 'block', beside: place, full: place }] as never }]);
  const notices = { background: () => undefined, refusal: () => undefined } as unknown as Notices;
  const opening = new Opening(kinds, {} as never, {} as never, notices, new Host('desktop', 'macos'));
  const app = mountApp(
    Layer.mergeAll(Overlays, testAddressing),
    Layer.mergeAll(
      Layer.of(Router, makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') })),
      Layer.of(ThreadNames, new ThreadNames(() => null)),
      Layer.of(Notices, notices),
      Layer.of(BlockTitles, { answered: 0, peer: () => ({ title: 'Notes', project: 'runlith' }) } as never),
      Layer.of(Opening, opening),
    ),
    {
      ladder: [TileRung, ProjectRung, GraphRung],
      at: { tile: { tileId: 5 }, project: { projectId: 5 }, graph: { projectId: 5, branch: null } },
    },
  );
  const target = document.body.appendChild(document.createElement('div'));
  const store = { rootName: '24e6b6b0', blocks: new Map(), block: () => undefined, setBody: async () => undefined };
  const body = mount(TestHost, { target, props: { app: app.app, view: Body as never, props: { body: 'See [[5b386d76]].', store } } });
  const menu = mount(TestHost, { target, props: { app: app.app, view: LinkMenu as never, props: {} } });
  const pointAt = document.elementFromPoint;
  try {
    await waitUntil(() => target.querySelector('[data-bracket-ref-target="5b386d76"]') !== null);
    const ref = target.querySelector<HTMLElement>('[data-bracket-ref-target="5b386d76"]')!;
    document.elementFromPoint = () => ref;
    target.querySelector<HTMLElement>('.ProseMirror')!.focus();
    const press = { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: 1, clientY: 1 };
    ref.dispatchEvent(new MouseEvent('mousedown', press));
    ref.dispatchEvent(new MouseEvent('contextmenu', press));
    flushSync();
    await waitUntil(() => document.activeElement?.closest('[data-link-menu]') != null);
    ref.dispatchEvent(new MouseEvent('mouseup', { ...press, buttons: 0 }));
    flushSync();
    expect(opening.aim?.link).toEqual({ kind: 'block', target: { name: '5b386d76' }, from: undefined });
    expect(document.querySelector('[data-link-menu]')).not.toBeNull();
  } finally {
    document.elementFromPoint = pointAt;
    await unmount(menu);
    await unmount(body);
    target.remove();
    await app.unmount();
  }
});

test('editing prose keeps thread addresses and labels while references in code remain literal', () => {
  const source = `Before [[${thread}|исходном треде]] and [[5b386d76]].\n\n\`[[${thread}]]\`\n\n\`\`\`\n[[${thread}]]\n\`\`\``;
  const editor = createHeadlessMarkdownEditor(
    createMarkdownEditorExtensions({
      extensions: bodyEditorExtensions(
        { block: () => undefined } as never,
        { peer: () => undefined } as never,
        makeRouter(),
        testAddresses(),
        new ThreadNames(() => null),
      ),
    }),
    source,
  );
  try {
    editor.commands.insertContentAt(1, 'Edited ');
    expect(editor.getMarkdown()).toBe(`Edited ${source}`);
  } finally {
    editor.destroy();
  }
});
