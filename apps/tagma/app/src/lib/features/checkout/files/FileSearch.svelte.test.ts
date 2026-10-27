// @vitest-environment jsdom
import type { SearchFrame } from '@tagma/server/checkout-files/contract/wire/search';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { FileSearch } from './FileSearch.svelte.js';

function standing() {
  const held: { frame: (frame: SearchFrame) => void; ending: string | undefined; unsubscribed: boolean; ask: unknown }[] = [];
  const live = {
    hold: (
      open: (client: unknown) => unknown,
      frame: (frame: SearchFrame) => void,
      _failed: unknown,
      _resume: unknown,
      ending?: string,
    ) => {
      const one = { frame, ending, unsubscribed: false, ask: undefined as unknown };
      open({ 'search.subscribe': (ask: unknown) => void (one.ask = ask) });
      held.push(one);
      return { unsubscribe: () => void (one.unsubscribed = true) };
    },
  };
  let search!: FileSearch;
  const stop = $effect.root(() => {
    search = new FileSearch(
      live as never,
      { aim: { projectId: 1, branch: null } } as never,
      { row: { rootId: 'root-1' } } as never,
      { defer: () => undefined } as never,
    );
  });
  return { search, held, stop };
}

test('a query is one pass of the stream: files list by name once it is over, the count is the server’s, and a new query drops the old pass', () => {
  const { search, held, stop } = standing();
  search.pattern = 'foo';
  flushSync();
  expect(held).toHaveLength(1);
  expect(held[0]?.ending).toBe('once');
  expect(held[0]?.ask).toMatchObject({ root: 'root-1', pattern: 'foo' });

  held[0]?.frame({
    kind: 'file',
    file: 'b.ts',
    mediaType: 'text/javascript',
    matches: [
      {
        line: 1,
        preview: 'foo foo',
        ranges: [
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ],
      },
    ],
  });
  held[0]?.frame({
    kind: 'file',
    file: 'a.ts',
    mediaType: 'text/javascript',
    matches: [{ line: 3, preview: 'foo', ranges: [{ start: 0, end: 3 }] }],
  });
  flushSync();
  expect(search.searching).toBe(true);
  expect(search.files).toBe(2);

  held[0]?.frame({ kind: 'done', files: 2, matches: 3, truncated: false, elapsed: 5 });
  flushSync();
  expect(search.searching).toBe(false);
  expect(search.done?.matches).toBe(3);
  expect(search.rows(10).rows.map((row) => (row.kind === 'file' ? row.file : row.match.line))).toEqual(['a.ts', 3, 'b.ts', 1]);

  search.pattern = 'foob';
  flushSync();
  expect(held[0]?.unsubscribed).toBe(true);
  expect(held).toHaveLength(2);
  expect(search.files).toBe(0);
  expect(search.done).toBeNull();
  stop();
});
