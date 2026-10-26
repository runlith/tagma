import { makeStorage } from '@runlith/layer/testing';
import { describe, expect, test } from 'vitest';
import { PromptStore } from './PromptStore.js';

describe('the prompts a project recalls', () => {
  test('what one page life wrote is what the next one reads', () => {
    const storage = makeStorage();

    new PromptStore(storage, 7).write([
      { text: 'дай задание', at: 2000 },
      { text: 'посмотри сюда', at: 1000 },
    ]);

    expect(new PromptStore(storage, 7).read()).toEqual([
      { text: 'дай задание', at: 2000 },
      { text: 'посмотри сюда', at: 1000 },
    ]);
  });

  test('a project reads its own record and no other graph’s', () => {
    const storage = makeStorage();

    new PromptStore(storage, 7).write([{ text: 'about this graph', at: 2000 }]);
    new PromptStore(storage, 8).write([{ text: 'about that one', at: 2000 }]);

    expect(new PromptStore(storage, 7).read().map((entry) => entry.text)).toEqual(['about this graph']);
    expect(new PromptStore(storage, 8).read().map((entry) => entry.text)).toEqual(['about that one']);
  });

  test('a record this browser cannot read costs the history and nothing else', () => {
    expect(new PromptStore(makeStorage({ 'tagma.prompts.7': '{ not json' }), 7).read()).toEqual([]);
    expect(new PromptStore(makeStorage({ 'tagma.prompts.7': '{"prompts":[]}' }), 7).read()).toEqual([]);
    expect(new PromptStore(makeStorage({ 'tagma.prompts.7': '[{"text":"kept"},null,42,{"at":3}]' }), 7).read()).toEqual([
      { text: 'kept', at: 0 },
    ]);
  });
});
