// @vitest-environment jsdom
import { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Picked } from '@tagma/server/browser/contract/wire/pick';
import { expect, test } from 'vitest';
import { testShelf } from '$lib/features/threads/native/testing.js';
import { ThreadDraft } from '$lib/features/threads/Draft.svelte.js';
import type { CallPieces } from '$lib/features/threads/native/CallPieces.js';
import type { ThreadUploads } from '$lib/features/threads/native/ThreadUploads.js';
import { Picks } from './Picks.js';

const draftOf = (key: string): ThreadDraft => {
  const draft = new ThreadDraft(testShelf(), {} as ThreadUploads, {} as CallPieces);
  draft.useKey(key);
  return draft;
};

const PICKED: Picked = {
  page: PageId.make('01a149e7-page'),
  url: 'https://example.com/form',
  ref: 'e12',
  role: 'button',
  name: 'Send',
  tag: 'button',
  selector: 'form > button.send',
  text: 'Send',
  html: '<button class="send">Send</button>',
  attributes: { class: 'send' },
  styles: { color: 'rgb(0, 0, 0)' },
  rect: { x: 10, y: 20, width: 80, height: 24 },
  picture: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

test('a picked element lands in the field of the thread on screen, with its page, reference and picture', async () => {
  const draft = draftOf('beside');
  const picks = new Picks({ host: { stageDocument: (document) => draft.stageDocument(document), attach: (files) => draft.attach(files) } });

  expect(await picks.stage(PICKED)).toBeNull();

  expect(draft.documents).toHaveLength(1);
  expect(draft.documents[0]?.text).toContain('`01a149e7-page`');
  expect(draft.documents[0]?.text).toContain('`e12`');
  expect(draft.images.map((image) => image.mediaType)).toEqual(['image/png']);
});
