import { describe, expect, test } from 'vitest';
import { ChatDraftShelf } from './draftShelf.svelte';

describe('the draft shelf', () => {
  test('one key answers with the same slot until it is forgotten', () => {
    const shelf = slots();
    const slot = shelf.at('thread:a');
    slot.text = 'half a sentence';

    expect(shelf.at('thread:a')).toBe(slot);
    expect(shelf.at('thread:b').text).toBe('');

    shelf.forget('thread:a');
    expect(shelf.at('thread:a').text).toBe('');
  });

  test('renaming moves the slot and frees the old key', () => {
    const shelf = slots();
    const slot = shelf.at('new:1');
    slot.text = 'what the unstarted thread was told';

    shelf.rename('new:1', 'thread:a');

    expect(shelf.at('thread:a')).toBe(slot);
    expect(shelf.at('new:1').text).toBe('');
  });
});

function slots(): ChatDraftShelf<{ text: string }> {
  return new ChatDraftShelf(() => ({ text: '' }));
}
