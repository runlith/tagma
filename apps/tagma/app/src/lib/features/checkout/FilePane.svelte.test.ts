// @vitest-environment jsdom
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { expect, test } from 'vitest';
import { mountShell } from '$lib/app/testing.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { resolveKeys } from '$lib/app/keys/resolve.js';
import { type Action, keyedOf } from '$lib/features/workspace/action.js';
import { actions } from './actions.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Documents } from './files/Documents.svelte.js';
import { FileOpener } from './files/FileOpener.svelte.js';
import { MarkdownPreview } from './files/MarkdownPreview.js';
import { Outside } from './files/Outside.svelte.js';
import { Tabs } from './files/Tabs.svelte.js';
import type { DocumentBody } from './files/OpenedDocument.svelte.js';
import type { DocumentPlace } from './files/documentKey.js';
import { filePane } from './paneContent.js';
import FilePane from './FilePane.svelte';

test('a sidebar file previews Markdown and returns to its source in place, including a file from another project', async () => {
  const path = '.agents/skills/tagma-design/SKILL.md';
  const source = $state<{ body: DocumentBody; revision: number }>({ body: { kind: 'loading' }, revision: 0 });
  const pane = $state({ key: 'file', ...filePane({ projectId: 5, rootId: 'root-5' as never, path, at: null }) });
  const app = mountShell(
    Layer.mergeAll(Keymap, ReaderMarks),
    Layer.mergeAll(
      Layer.of(SidePanes, { opened: () => 0 } as never),
      Layer.of(Door, {} as never),
      Layer.of(Tabs, { projectId: 5 } as never),
      Layer.of(FileOpener, {} as never),
      Layer.of(Outside, {
        chosen: null,
        editors: [],
        local: false,
        hold: () => ({ front: () => undefined, release: () => undefined }),
      } as never),
      Layer.of(Opening, { anchored: () => null } as never),
      Layer.of(MarkdownPreview, { Markdown: MarkdownBody }),
      Layer.of(Documents, {
        hold: (place: DocumentPlace) => ({
          document: {
            get body() {
              return source.body;
            },
            get revision() {
              return source.revision;
            },
            text: () => `# Project ${place.projectId}`,
            leave: async () => undefined,
          },
          release: () => undefined,
        }),
      } as never),
    ),
    { at: { projectId: 5, branch: null } },
  );
  app.get(Keymap).set(resolveKeys(keyedOf(actions as readonly Action[], app.get(Host)), {}, []));
  try {
    const target = app.draw(FilePane as never, { pane, close: () => undefined });
    flushSync();
    const open = (keyboard = false) => {
      const button = target.querySelector<HTMLButtonElement>('button[aria-label="Open preview"]');
      expect(button).not.toBeNull();
      if (keyboard) {
        button!.focus();
        button!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
        );
      } else button!.click();
      flushSync();
      source.body = { kind: 'text', readOnly: null, size: 20 };
      source.revision += 1;
    };
    const back = () => {
      source.body = { kind: 'loading' };
      flushSync();
      target.querySelector<HTMLButtonElement>('button[aria-label="Open the source"]')!.click();
      flushSync();
      expect(target.querySelector('[data-file-tab]')?.getAttribute('data-file-tab')).toBe(path);
      expect(target.querySelector('[data-preview-tab]')).toBeNull();
    };
    open();
    await waitUntil(() => target.querySelector('[data-preview-tab] h1')?.textContent === 'Project 5');
    back();

    Object.assign(pane, filePane({ projectId: 7, rootId: 'root-7' as never, path, at: null }));
    flushSync();
    open(true);
    await waitUntil(() => target.querySelector('[data-preview-tab] h1')?.textContent === 'Project 7');
    back();
  } finally {
    await app.unmount();
  }
});
