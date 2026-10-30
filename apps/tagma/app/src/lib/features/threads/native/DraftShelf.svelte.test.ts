// @vitest-environment jsdom
import { makeStorage } from '@runlith/layer/testing';
import { chatDraftFile } from '@runlith/chat-ui/draftFiles';
import { type ChatDraftImage, chatDraftImage } from '@runlith/chat-ui/draftImages';
import { IDBFactory } from 'fake-indexeddb';
import { expect, test } from 'vitest';
import { DraftFiles } from './DraftFiles.js';
import { DraftShelf } from './DraftShelf.svelte.js';

function pictures(): DraftFiles {
  return new DraftFiles(new IDBFactory());
}

function picture(id: string, filename: string, bytes: readonly number[]): Promise<ChatDraftImage> {
  return chatDraftImage(id, filename, 'image/png', new File([new Uint8Array(bytes)], filename, { type: 'image/png' }));
}

async function bytesOf(image: ChatDraftImage): Promise<number[]> {
  return [...new Uint8Array(await image.file.arrayBuffer())];
}

test('what was typed and staged at an address stands after the page ends', () => {
  const storage = makeStorage();
  const kept = pictures();
  const first = new DraftShelf(storage, kept);
  const slot = first.at('new:47');
  slot.text = 'the prompt nobody sent yet';
  slot.mentions = [{ name: 'a1b2c3d4', title: 'The Composer', tag: 'claim' }];
  slot.type = 'code';
  slot.account = 'me@example.com';
  slot.switches = { speed: 'fast' };
  slot.place = { kind: 'new', base: 'tagma/sidebar' };
  first.keep('new:47');

  const reloaded = new DraftShelf(storage, kept).at('new:47');
  expect(reloaded.place).toEqual({ kind: 'new', base: 'tagma/sidebar' });
  expect(reloaded.text).toBe('the prompt nobody sent yet');
  expect(reloaded.mentions).toEqual([{ name: 'a1b2c3d4', title: 'The Composer', tag: 'claim' }]);
  expect(reloaded.type).toBe('code');
  expect(reloaded.account).toBe('me@example.com');
  expect(reloaded.switches).toEqual({ speed: 'fast' });
  expect(reloaded.name).toBe(slot.name);
});

test('a draft emptied by its send leaves nothing for the next page to restore', () => {
  const storage = makeStorage();
  const shelf = new DraftShelf(storage, pictures());
  const slot = shelf.at('thread:t1');
  slot.text = 'sent';
  shelf.keep('thread:t1');

  slot.text = '';
  shelf.keep('thread:t1');

  expect(new DraftShelf(storage, pictures()).at('thread:t1').text).toBe('');
});

test('the record follows the draft to the address its thread got, and a forgotten thread takes it', () => {
  const storage = makeStorage();
  const kept = pictures();
  const shelf = new DraftShelf(storage, kept);
  shelf.at('new:47').text = 'typed before the thread existed';
  shelf.keep('new:47');

  shelf.rename('new:47', 'thread:t9');
  const afterBirth = new DraftShelf(storage, kept);
  expect(afterBirth.at('thread:t9').text).toBe('typed before the thread existed');
  expect(afterBirth.at('new:47').text).toBe('');

  shelf.forget('thread:t9');
  expect(new DraftShelf(storage, kept).at('thread:t9').text).toBe('');
});

test('two tabs parking drafts at different addresses both find theirs after a reload', () => {
  const storage = makeStorage();
  const kept = pictures();
  const first = new DraftShelf(storage, kept);
  const second = new DraftShelf(storage, kept);

  first.at('thread:a').text = 'typed in the first tab';
  first.keep('thread:a');
  second.at('thread:b').text = 'typed in the second tab';
  second.keep('thread:b');

  const reloaded = new DraftShelf(storage, kept);
  expect(reloaded.at('thread:a').text).toBe('typed in the first tab');
  expect(reloaded.at('thread:b').text).toBe('typed in the second tab');
});

test('staged pictures and PDFs come back after the page ends, in their order, at the address their thread got', async () => {
  const storage = makeStorage();
  const kept = pictures();
  const shelf = new DraftShelf(storage, kept);
  const slot = shelf.at('new:47');
  slot.images = [await picture('i1', 'a.png', [1, 2]), await picture('i2', 'b.png', [3])];
  slot.files = [chatDraftFile('f1', 'Договор.pdf', 'application/pdf', new File([new Uint8Array([37, 80])], 'Договор.pdf'))];
  shelf.keep('new:47');
  shelf.rename('new:47', 'thread:t9');

  const reloaded = new DraftShelf(storage, kept).at('thread:t9');
  await reloaded.restored;
  expect(reloaded.images.map((image) => [image.id, image.filename, image.mediaType])).toEqual([
    ['i1', 'a.png', 'image/png'],
    ['i2', 'b.png', 'image/png'],
  ]);
  expect(await Promise.all(reloaded.images.map(bytesOf))).toEqual([[1, 2], [3]]);
  expect(reloaded.files.map((file) => [file.id, file.filename, file.mediaType])).toEqual([['f1', 'Договор.pdf', 'application/pdf']]);
  expect([...new Uint8Array(await reloaded.files[0]!.file.arrayBuffer())]).toEqual([37, 80]);
  expect(reloaded.lostAttachments).toBe(0);
});

test('a picture taken out of the draft leaves the store, and a sent draft leaves none', async () => {
  const storage = makeStorage();
  const kept = pictures();
  const shelf = new DraftShelf(storage, kept);
  const slot = shelf.at('thread:t1');
  const [first, second] = [await picture('i1', 'a.png', [1]), await picture('i2', 'b.png', [2])];
  slot.images = [first, second];
  shelf.keep('thread:t1');
  slot.images = [first];
  shelf.keep('thread:t1');
  expect((await kept.read('thread:t1')).map((row) => row.id)).toEqual(['i1']);

  slot.images = [];
  shelf.keep('thread:t1');
  expect(await kept.read('thread:t1')).toEqual([]);
});

test('pictures the store no longer holds are counted as lost, not shown', async () => {
  const storage = makeStorage();
  const shelf = new DraftShelf(storage, pictures());
  const slot = shelf.at('new:47');
  slot.text = 'look at this';
  slot.images = [await picture('i1', 'a.png', [1]), await picture('i2', 'b.png', [2])];
  shelf.keep('new:47');

  const reloaded = new DraftShelf(storage, pictures()).at('new:47');
  await reloaded.restored;
  expect(reloaded.images).toEqual([]);
  expect(reloaded.lostAttachments).toBe(2);
});

test('past the ceiling the oldest record falls off and the newest stands', () => {
  const storage = makeStorage();
  const kept = pictures();
  const shelf = new DraftShelf(storage, kept);
  for (let index = 0; index < 60; index += 1) {
    shelf.at(`thread:t${index}`).text = `draft ${index}`;
    shelf.keep(`thread:t${index}`);
  }

  const reloaded = new DraftShelf(storage, kept);
  expect(reloaded.at('thread:t59').text).toBe('draft 59');
  expect(reloaded.at('thread:t0').text).toBe('');
});
