// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { Explorer } from './Explorer.svelte.js';

const file = (name: string) => ({ name, kind: 'file' as const, ignored: false });
const folder = (name: string) => ({ name, kind: 'directory' as const, ignored: false });

const PAGES: Record<string, readonly { entries: readonly ReturnType<typeof file>[]; next: string | null }[]> = {
  '': [{ entries: [folder('src') as never, file('README.md')], next: null }],
  src: [
    { entries: [folder('deep') as never, file('a.ts')], next: 'page-2' },
    { entries: [file('zeta.ts')], next: null },
  ],
  'src/deep': [{ entries: [file('x.ts')], next: null }],
};

function standing() {
  const asked: { path: string; cursor: string | undefined }[] = [];
  const door = {
    aim: { projectId: 1, branch: null },
    perform: async (_id: string, input: { path?: string; cursor?: string }) => {
      asked.push({ path: input.path ?? '', cursor: input.cursor });
      const pages = PAGES[input.path ?? ''] ?? [];
      const page = input.cursor === undefined ? pages[0] : pages[1];
      return { status: 'ok', entries: page?.entries ?? [], total: 3, next: page?.next ?? null };
    },
  };
  let explorer!: Explorer;
  $effect.root(() => {
    explorer = new Explorer(
      { hold: () => ({ unsubscribe: () => undefined }) } as never,
      door as never,
      { row: { rootId: 'root-1' }, sections: [] } as never,
      { defer: () => undefined } as never,
      { report: () => undefined } as never,
    );
  });
  flushSync();
  return { explorer, asked };
}

test('revealing a file past the first page of its folder loads pages until the file stands in the tree', async () => {
  const { explorer, asked } = standing();

  await explorer.reveal('src/zeta.ts');
  flushSync();

  expect(asked.filter((call) => call.path === 'src').map((call) => call.cursor)).toEqual([undefined, 'page-2']);
  expect(explorer.expanded.has('src')).toBe(true);
  expect(explorer.rows.some((row) => row.kind === 'entry' && row.path === 'src/zeta.ts')).toBe(true);
});

test('folding a folder folds the folders opened inside it, so they are not read again when frames come', async () => {
  const { explorer } = standing();
  await explorer.reveal('src/deep/x.ts');
  expect([...explorer.expanded].sort()).toEqual(['src', 'src/deep']);

  explorer.collapse('src');

  expect([...explorer.expanded]).toEqual([]);
});
