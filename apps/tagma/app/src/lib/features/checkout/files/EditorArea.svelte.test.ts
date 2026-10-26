// @vitest-environment jsdom
import type { DocumentFrame } from '@tagma/server/checkout-files/contract/wire/document';
import type { CheckoutState } from '@tagma/server/workspace/contract/wire/checkout';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { liveFeed, mountShell, screen, type TestApp, testPlaces } from '$lib/app/testing.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Holdings } from '$lib/features/checkout/Holdings.svelte.js';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { FileOpener } from './FileOpener.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Outside } from './Outside.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectsRepo } from '$lib/features/workspace/ProjectsRepo.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { Live } from '$lib/wire/Live.js';
import { Door } from '$lib/wire/Door.js';
import { AutoSave } from './AutoSave.svelte.js';
import { Column } from './Column.svelte.js';
import EditorArea from './EditorArea.svelte';
import { Documents } from './Documents.svelte.js';
import { Tabs } from './Tabs.svelte.js';

let app: TestApp | undefined;

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
});

const ROOT = 'root-1' as RootId;

function draw() {
  const feed = liveFeed();
  app = mountShell(
    Layer.mergeAll(
      screen(),
      Checkout,
      Holdings,
      ThreadNames,
      Tabs,
      Column,
      Layer.of(AutoSave, { policyOf: () => ({ mode: 'afterDelay', delay: 1000 }) } as never),
      Layer.of(Door, { perform: () => Promise.reject(new Error('no door')) } as never),
      Documents,
      Notices,
      ReaderMarks,
      Keymap,
      Layer.of(GraphDoor, { aim: { projectId: 1, branch: null } } as never),
      Layer.of(FileOpener, { open: () => Promise.resolve(), stand: () => () => undefined } as never),
      Layer.of(Workspace, { find: () => undefined } as never),
      Layer.of(Worktrees, testPlaces() as never),
      Layer.of(Outside, { local: false, editors: [], chosen: null, hold: () => ({ front() {}, release() {} }) } as never),
    ),
    Layer.mergeAll(Layer.of(Live, feed.live), Layer.of(ProjectsRepo, { branches: { key: () => ({ data: [] }) } } as never)),
  );
  const page = app.draw(EditorArea as never);
  flushSync();
  feed.routes.get('checkout.subscribe')?.({ rootId: ROOT } as unknown as CheckoutState);
  return { page, feed, tabs: app.app.resolve(Tabs) };
}

const send = (feed: ReturnType<typeof liveFeed>, frame: DocumentFrame): void => {
  feed.routes.get('document.subscribe')?.(frame);
  flushSync();
};

test('an open file draws the text the server sends, takes the lines of a later change, and says so when the file is gone or not text', async () => {
  const { page, feed, tabs } = draw();
  tabs.open({ rootId: ROOT, path: 'src/a.ts', kind: 'file' }, 'open');
  flushSync();
  await Promise.resolve();

  expect(feed.asked.at(-1)).toMatchObject({ projectId: 1, root: ROOT, path: 'src/a.ts' });

  send(feed, { kind: 'whole', digest: 'd1', text: 'one\ntwo\n', readOnly: null, size: 8 });
  expect(page.querySelector('[data-file-editor]')?.textContent).toContain('one');

  send(feed, { kind: 'change', digest: 'd2', edits: [{ from: 1, to: 2, lines: ['2'] }] });
  expect(page.querySelector('[data-file-editor]')?.textContent).toContain('2');
  expect(page.querySelector('[data-file-editor]')?.textContent).not.toContain('two');

  send(feed, { kind: 'binary', size: 10 });
  expect(page.querySelector('[data-file-state="binary"]')).not.toBeNull();

  send(feed, { kind: 'gone' });
  expect(page.querySelector('[data-file-state="gone"]')).not.toBeNull();
});
