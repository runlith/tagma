import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { expect, test } from 'vitest';
import { FilesFeed, fileTargetOf } from './Files.svelte.js';

const AIM = { projectId: 1, root: 'root-1' as RootId, rootPath: '/work/main', recent: ['src/old.ts'] };

test('a tail of :line or :line:column leaves the file query and becomes the place to open at', () => {
  expect(fileTargetOf('feed:42')).toEqual({ query: 'feed', line: 42, column: null });
  expect(fileTargetOf('src/feed.ts:42:7')).toEqual({ query: 'src/feed.ts', line: 42, column: 7 });
  expect(fileTargetOf('feed')).toEqual({ query: 'feed', line: null, column: null });
});

test('every letter asks find_files with the recent paths, the older question is cancelled, and only the newest answer is kept', async () => {
  const calls: { query: string; recent: readonly string[]; signal: AbortSignal | undefined; settle: (paths: string[]) => void }[] = [];
  const feed = new FilesFeed({
    perform: (_id: string, input: { query: string; recent: readonly string[] }, _lens: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((resolve) => {
        calls.push({
          query: input.query,
          recent: input.recent,
          signal: options?.signal,
          settle: (paths) => resolve({ files: paths.map((path) => ({ path, positions: [] })), matched: paths.length }),
        });
      }),
  } as never);

  feed.ask(AIM, 'f');
  feed.ask(AIM, 'fe');

  expect(calls.map((call) => call.query)).toEqual(['f', 'fe']);
  expect(calls[0]?.recent).toEqual(['src/old.ts']);
  expect(calls[0]?.signal?.aborted).toBe(true);

  calls[1]?.settle(['src/feed.ts']);
  calls[0]?.settle(['src/stale.ts']);
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

  expect(feed.rows.map((row) => row.path)).toEqual(['src/feed.ts']);
  expect(feed.loading).toBe(false);
});

test('the same question again is not asked again, and a question about another checkout drops the rows of the old one at once', async () => {
  const calls: string[] = [];
  const feed = new FilesFeed({
    perform: (_id: string, input: { root: string; query: string }) => {
      calls.push(`${input.root}:${input.query}`);
      return Promise.resolve({ files: [{ path: `${input.root}/a.ts`, positions: [] }], matched: 1 });
    },
  } as never);

  feed.ask(AIM, 'a');
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  feed.ask({ ...AIM, recent: ['src/other.ts'] }, 'a');
  expect(calls).toEqual(['root-1:a']);

  feed.ask({ ...AIM, root: 'root-2' as RootId }, 'a');
  expect(feed.rows).toEqual([]);
  expect(calls).toEqual(['root-1:a', 'root-2:a']);
});
