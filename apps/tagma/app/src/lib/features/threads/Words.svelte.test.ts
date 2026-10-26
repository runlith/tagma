import { afterEach, expect, test, vi } from 'vitest';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ThreadWords } from './Words.svelte.js';

const FAR = '01a0d0bb-0000-7000-8000-000000000001';
const OLD = '01a0d0bb-0000-7000-8000-000000000002';
const GONE = '01a0d0bb-0000-7000-8000-000000000003';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const workspace = new (class {
  find(id: number) {
    return id === 2 ? { id: 2, name: 'polygon' } : null;
  }
})() as unknown as Workspace;

type Row = { id: string; projectId: number; name: string | null; title: string; harness: object | null; archivedAt: string | null };

function wordsOver(rows: (ids: readonly string[]) => Promise<readonly Row[]>, roots: number | null = 1) {
  const asked: Array<{ project: string | null; ids: string[] }> = [];
  const repo = {
    list: {
      key: (key: { project: string | null; selection: { ids: string } }) => ({
        refresh: () => {
          const ids = key.selection.ids.split(',');
          asked.push({ project: key.project, ids });
          return rows(ids).then((found) => ({ status: 'rows', rows: found }));
        },
      }),
    },
  };
  const live = { id: 'live', name: null, title: 'On screen', harness: null };
  const list = { threads: [live], row: (id: string) => (id === live.id ? live : undefined), archived: null, roots };
  return { words: new ThreadWords(list as never, repo as never, workspace, 1), asked, list };
}

afterEach(() => {
  vi.useRealTimers();
});

test('a thread outside the list is read by its id alone, and its words carry the home the answer names', async () => {
  const { words, asked } = wordsOver((ids) =>
    Promise.resolve(
      ids.map((id) => ({
        id,
        projectId: id === FAR ? 2 : 1,
        name: id === FAR ? 'Fix the build' : null,
        title: 'Old work',
        harness: id === FAR ? {} : null,
        archivedAt: id === OLD ? '2026-09-01T00:00:00Z' : null,
      })),
    ),
  );
  expect(words.of('live')?.label).toBe('On screen');
  expect(words.of(FAR)).toBe(undefined);
  expect(words.of(OLD)).toBe(undefined);
  await settle();
  expect(words.of(FAR)).toEqual({ label: 'Fix the build', archived: false, harness: true, home: 'polygon', projectId: 2 });
  expect(words.of(OLD)).toEqual({ label: 'Old work', archived: true, harness: false, projectId: 1 });
  expect(asked).toEqual([
    { project: null, ids: [FAR] },
    { project: null, ids: [OLD] },
  ]);
});

test('nothing is read before the list has loaded, and a holder that is not a thread id is never read', async () => {
  const { words, asked, list } = wordsOver(() => Promise.resolve([]), null);
  expect(words.of(FAR)).toBe(undefined);
  expect(words.of('foreign:claude-code:abc')).toBe(null);
  await settle();
  expect(asked).toEqual([]);
  list.roots = 1;
  words.of(FAR);
  await settle();
  expect(asked).toEqual([{ project: null, ids: [FAR] }]);
});

test('a failed read leaves a thread unknown and is read again after a minute; a thread the read cannot find has no words', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let failing = true;
  const { words, asked } = wordsOver((ids) =>
    failing
      ? Promise.reject(new Error('down'))
      : Promise.resolve(
          ids.filter((id) => id !== GONE).map((id) => ({ id, projectId: 1, name: 'Back', title: 't', harness: null, archivedAt: null })),
        ),
  );
  words.of(FAR);
  words.of(GONE);
  await settle();
  expect(words.of(FAR)).toBe(undefined);
  expect(words.of(GONE)).toBe(undefined);

  failing = false;
  vi.setSystemTime(Date.now() + 60_000);
  words.of(FAR);
  words.of(GONE);
  await settle();
  expect(words.of(FAR)?.label).toBe('Back');
  expect(words.of(GONE)).toBe(null);
  expect(asked).toHaveLength(4);
});

test('a thread of another project is named by a read in that project, and the own list is never consulted for it', async () => {
  const asked: Array<{ project: string; ids: string }> = [];
  const repo = {
    list: {
      key: (key: { project: string; selection: { ids: string } }) => ({
        refresh: () => {
          asked.push({ project: key.project, ids: key.selection.ids });
          return Promise.resolve({
            status: 'rows',
            rows: [{ id: FAR, projectId: 2, name: 'Elsewhere', title: 't', harness: null, archivedAt: null }],
          });
        },
      }),
    },
  };
  const own = { id: FAR, name: null, title: 'Same id here', harness: null };
  const list = { threads: [own], row: (id: string) => (id === FAR ? own : undefined), archived: null, roots: 1 };
  const words = new ThreadWords(list as never, repo as never, workspace, 1);

  expect(words.of(FAR)?.label).toBe('Same id here');
  expect(words.of(FAR, '2')).toBe(undefined);
  await settle();
  expect(words.of(FAR, '2')?.label).toBe('Elsewhere');
  expect(asked).toEqual([{ project: '2', ids: FAR }]);
});

test('a listed member homed in another project names that home, one whose home the registry does not name yet says so, and one homed here names none', () => {
  const away = { id: 'away', projectId: 2, name: 'reviewer', title: 't', harness: null };
  const unnamed = { id: 'unnamed', projectId: 9, name: 'scout', title: 't', harness: null };
  const here = { id: 'here', projectId: 1, name: 'builder', title: 't', harness: null };
  const rows = new Map([away, unnamed, here].map((row) => [row.id, row]));
  const list = { threads: [...rows.values()], row: (id: string) => rows.get(id), archived: null, roots: 1 };
  const words = new ThreadWords(list as never, {} as never, workspace, 1);

  expect(words.of('away')?.home).toBe('polygon');
  expect(words.of('unnamed')?.home).toBeNull();
  expect(words.of('here')?.home).toBeUndefined();
});

test('a thread of another project is named while the own list has not loaded, and a blank name falls back to the title', async () => {
  const repo = {
    list: {
      key: () => ({
        refresh: () =>
          Promise.resolve({
            status: 'rows',
            rows: [{ id: FAR, projectId: 2, name: '  ', title: 'Titled', harness: null, archivedAt: null }],
          }),
      }),
    },
  };
  const list = { threads: [], row: () => undefined, archived: null, roots: null };
  const words = new ThreadWords(list as never, repo as never, workspace, 1);

  expect(words.of(OLD)).toBe(undefined);
  expect(words.of(FAR, '2')).toBe(undefined);
  await settle();
  expect(words.of(FAR, '2')?.label).toBe('Titled');
});
