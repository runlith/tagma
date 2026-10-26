// @vitest-environment jsdom
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { makeStorage } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import type { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import type { FileOpener } from './FileOpener.svelte.js';
import { Tabs } from './Tabs.svelte.js';

const ROOT = 'root-1' as RootId;
const AIM = { projectId: 1, branch: null };

function standing(storage = makeStorage(), checkout = { row: { rootId: ROOT }, branches: [] as { branch: string }[] }) {
  const state = $state(checkout);
  let tabs!: Tabs;
  $effect.root(() => {
    tabs = new Tabs(
      storage,
      AIM,
      state as unknown as Checkout,
      { stand: () => () => undefined } as unknown as FileOpener,
      { show: () => undefined } as never,
      {
        get: () => undefined,
        onRelocated: () => () => undefined,
        abandon: () => undefined,
        isGone: () => false,
        markGone: () => undefined,
      } as never,
      { unsettled: () => false } as never,
      { defer: () => undefined } as never,
    );
  });
  flushSync();
  return { tabs, storage, state };
}

const file = (path: string) => ({ rootId: ROOT, path, kind: 'file' as const });

test('the open set, the active tab and the recent paths come back from storage; content and the pending jump do not', () => {
  const { tabs, storage } = standing();
  tabs.open({ ...file('a.ts'), goto: { line: 3, column: 0 } }, 'open');
  tabs.open(file('b.ts'), 'open');
  tabs.pin(tabs.tabs[0]?.id ?? '', true);
  tabs.activate(tabs.tabs[0]?.id ?? '');

  const again = standing(storage).tabs;

  expect(again.tabs.map((tab) => [tab.path, tab.state])).toEqual([
    ['a.ts', 'pinned'],
    ['b.ts', 'open'],
  ]);
  expect(again.active?.path).toBe('a.ts');
  expect(again.active?.goto).toBeNull();
  expect(again.recent).toEqual(['b.ts', 'a.ts']);
});

test('a preview opens on the place of the previous preview, and is kept by a second open or a double click', () => {
  const { tabs } = standing();
  tabs.open(file('a.ts'), 'preview');
  tabs.open(file('b.ts'), 'preview');
  expect(tabs.tabs.map((tab) => tab.path)).toEqual(['b.ts']);

  tabs.open(file('b.ts'), 'open');
  tabs.open(file('c.ts'), 'preview');
  tabs.open(file('d.ts'), 'preview');

  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([
    ['b.ts', 'open'],
    ['d.ts', 'preview'],
  ]);
});

test('closing the active tab moves to its neighbour, close others spares pinned tabs, and the last closed ones come back in order', () => {
  const { tabs } = standing();
  for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) tabs.open(file(path), 'open');
  const id = (path: string): string => tabs.tabs.find((tab) => tab.path === path)?.id ?? '';
  tabs.pin(id('a.ts'), true);

  tabs.activate(id('c.ts'));
  tabs.close(id('c.ts'));
  expect(tabs.active?.path).toBe('d.ts');

  tabs.closeOthers(id('b.ts'));
  expect(tabs.tabs.map((tab) => tab.path)).toEqual(['a.ts', 'b.ts']);

  tabs.close(id('b.ts'));
  expect(tabs.reopen()?.path).toBe('b.ts');
  expect(tabs.reopen()?.path).toBe('d.ts');
});

test('a moved tab takes the pin of the place it lands in, so the pinned ones stay first', () => {
  const { tabs } = standing();
  for (const path of ['a.ts', 'b.ts', 'c.ts']) tabs.open(file(path), 'open');
  const id = (path: string): string => tabs.tabs.find((tab) => tab.path === path)?.id ?? '';
  tabs.pin(id('a.ts'), true);

  tabs.move(id('c.ts'), id('a.ts'));
  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([
    ['c.ts', 'pinned'],
    ['a.ts', 'pinned'],
    ['b.ts', 'open'],
  ]);

  tabs.move(id('c.ts'), null);
  expect(tabs.tabs.map((tab) => [tab.path, tab.state])).toEqual([
    ['a.ts', 'pinned'],
    ['b.ts', 'open'],
    ['c.ts', 'open'],
  ]);
});

test('a closed tab comes back with its selection and scroll, even when the editor reports them after the close', () => {
  const { tabs } = standing();
  tabs.open(file('a.ts'), 'open');
  tabs.open(file('b.ts'), 'open');
  const id = tabs.tabs[0]?.id ?? '';

  const view = { line: 7, column: 2, anchor: { line: 10, column: 4 }, scroll: 120 };
  tabs.close(id);
  tabs.see(id, view);

  expect(tabs.reopen()?.view).toEqual(view);
});

test('a changed selection with the same head survives the storage round trip', () => {
  const { tabs, storage } = standing();
  const tab = tabs.open(file('a.ts'), 'open');
  tabs.see(tab.id, { line: 7, column: 2, anchor: { line: 7, column: 2 }, scroll: 120 });
  const view = { line: 7, column: 2, anchor: { line: 10, column: 4 }, scroll: 120 };
  tabs.see(tab.id, view);

  expect(standing(storage).tabs.active?.view).toEqual(view);
});

test('tabs of the aimed checkout follow it when its root is made again; a tab of another branch is an orphan once that branch is gone', () => {
  const { tabs, state } = standing();
  tabs.open(file('a.ts'), 'open');
  tabs.open({ ...file('b.ts'), branch: 'feature' }, 'open');
  state.branches = [{ branch: 'feature' }];
  expect(tabs.orphaned(tabs.tabs[1] as never)).toBe(false);

  state.row = { rootId: 'root-2' as RootId };
  flushSync();

  expect(tabs.tabs.map((tab) => [tab.path, tab.rootId])).toEqual([
    ['a.ts', 'root-2'],
    ['b.ts', ROOT],
  ]);
  state.branches = [{ branch: 'other' }];
  expect(tabs.orphaned(tabs.tabs[1] as never)).toBe(true);
});
