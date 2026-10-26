// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, test } from 'vitest';
import type { ChatEntry } from './entries';
import { EntryIndex } from './EntryIndex.svelte';

const said = (id: string, runId: string, text = id): ChatEntry => ({ kind: 'assistant', id, runId, text }) as ChatEntry;

function feed(entries: ChatEntry[]) {
  const index = new EntryIndex((id) => entries.findIndex((entry) => entry.id === id));
  index.splice(0, [], entries);
  return { index, entries };
}

describe('the entry that closes its run', () => {
  test('the last entry of a run closes it until a later entry of the same run arrives', () => {
    const { index, entries } = feed([said('a', 'run-1'), said('b', 'run-1'), said('c', 'run-2')]);

    expect(index.closesRun('assistant', 0, 'run-1')).toBe(false);
    expect(index.closesRun('assistant', 1, 'run-1')).toBe(true);

    const later = said('b2', 'run-1');
    entries.splice(2, 0, later);
    index.splice(2, [], [later]);

    expect(index.closesRun('assistant', 1, 'run-1')).toBe(false);
    expect(index.closesRun('assistant', 2, 'run-1')).toBe(true);
  });

  test('a reader of a closed run is not read again when another entry only grows its text', () => {
    const { index, entries } = feed([said('a', 'run-1'), said('b', 'run-2')]);
    let reads = 0;
    const stop = $effect.root(() => {
      $effect(() => {
        index.closesRun('assistant', 0, 'run-1');
        reads += 1;
      });
    });
    flushSync();

    const grown = said('b', 'run-2', 'b grows');
    index.patch(1, entries[1]!, grown);
    entries[1] = grown;
    flushSync();
    expect(reads).toBe(1);

    const joined = said('a2', 'run-1');
    entries.splice(1, 0, joined);
    index.splice(1, [], [joined]);
    flushSync();
    expect(reads).toBe(2);
    expect(index.closesRun('assistant', 0, 'run-1')).toBe(false);
    stop();
  });
});
