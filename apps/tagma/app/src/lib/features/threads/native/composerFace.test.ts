import { PromptHandle } from '@runlith/chat-ui/PromptHandle.svelte';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import type { Resolver } from '@runlith/layer/key';
import { makePoint } from '@runlith/layer/testing';
import { TagmaRefused } from '@runlith/tagma/plugin';
import { expect, test } from 'vitest';
import { StagedKinds } from '$lib/shared/threads/staged.js';
import { ThreadDraft } from '../Draft.svelte.js';
import { ShownThread } from '../ShownThread.js';
import { composerFace } from './composerFace.js';
import { StagedItems } from './StagedItems.js';
import { testShelf } from './testing.js';
import type { ThreadUploads } from './ThreadUploads.js';

const opened = (thread: string, said: ChatNotice[] = []) => {
  const draft = new ThreadDraft(testShelf(), {} as ThreadUploads, new StagedItems(makePoint(StagedKinds), {} as Resolver, 1));
  draft.useKey(`thread:${thread}`);
  const shown = new ShownThread(
    1,
    () => thread,
    () => null,
    () => null,
    () => null,
  );
  const chat = { session: null, commands: { say: (notice: ChatNotice) => void said.push(notice) } };
  const writes = { send: () => Promise.resolve(true) };
  return { draft, face: composerFace(shown, draft.held(), draft, chat as never, writes as never, new PromptHandle()) };
};

test('a face writes the draft of the thread it was made for after the composer moved to another one', () => {
  const { draft, face } = opened('a');
  draft.useKey('thread:b');
  draft.setText('words for b');

  face.draft.setText('the answer for a');

  expect(draft.text).toBe('words for b');
  draft.useKey('thread:a');
  expect(draft.text).toBe('the answer for a');
});

test('an attachment the draft refuses rejects the part’s attach and is told in the composer', async () => {
  const said: ChatNotice[] = [];
  const { face } = opened('a', said);

  const attached = face.draft.attach([new File(['x'], 'notes.zip', { type: 'application/zip' })]);

  await expect(attached).rejects.toBeInstanceOf(TagmaRefused);
  expect(said.map((notice) => notice.tone)).toEqual(['error']);
});
