// @vitest-environment jsdom
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { FolderActs } from '$lib/features/threads/FolderActs.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import Actions from './Actions.svelte';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a thread act closes the sheet and acts on the thread it was opened for', async () => {
  const renamed: [string, string][] = [];
  const list = { folders: [], rename: async (id: string, title: string) => void renamed.push([id, title]) };
  app = mountShell(
    Layer.mergeAll(
      Layer.of(ThreadList, list as never),
      Layer.of(FolderActs, {} as never),
      Layer.of(Notices, { refusal: () => undefined } as never),
    ),
  );
  let held = $state<ThreadListRow | null>({ id: 'thread-1', title: 'Old', pinnedAt: null, folderId: null } as ThreadListRow);
  const view = app.draw(Actions as never, {
    get row() {
      return held;
    },
    onClose: () => (held = null),
  });
  flushSync();

  [...view.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Rename')!.click();
  flushSync();
  const field = view.querySelector('input')!;
  field.value = 'New';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  view.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  expect(held).toBeNull();
  const closing = app.unmount();
  app = undefined;
  await closing;

  await vi.waitFor(() => expect(renamed).toEqual([['thread-1', 'New']]));
});
