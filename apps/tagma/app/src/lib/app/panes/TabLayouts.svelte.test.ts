import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { testSurfaces } from '$lib/app/testing.js';
import { draftHolder, type Holder, sectionHolder, threadHolder as held } from '$lib/shared/panes/holder.js';
import { panes as tagmaAppKinds } from '$lib/features/tagma-apps/panes.js';
import { panes as threadKinds } from '$lib/features/threads/panes.js';
import { PaneRegistry } from './PaneRegistry.js';
import { KEPT_DAYS, KEPT_HOLDERS, TabLayouts } from './TabLayouts.svelte.js';
import { testKind } from './testing.js';

const KINDS = new PaneRegistry([...threadKinds, ...tagmaAppKinds, testKind('file'), testKind('browser')]);
const SURFACES = testSurfaces();
const DAY_MS = 86_400_000;

function layoutsOn(storage = makeStorage(), now = () => 1_000 * DAY_MS) {
  return new TabLayouts(1, storage, KINDS, SURFACES, now);
}

const ids = (layouts: TabLayouts, holder: Holder) => layouts.layout(holder).tabs.map((tab) => `${tab.kind}:${tab.id}`);

const A = held('a');
const B = held('b');

test('two threads keep their own tabs, and coming back finds the set, order and active tab as left, across a reload', () => {
  const storage = makeStorage();
  const layouts = layoutsOn(storage);
  layouts.open(A, { kind: 'file', id: 'one.ts' });
  const page = layouts.open(A, { kind: 'browser', id: '1:p1' });
  layouts.open(A, { kind: 'file', id: 'two.ts' });
  if (page.kind === 'refused') throw new Error('The page tab was refused.');
  layouts.activate(A, page.key);
  layouts.open(B, { kind: 'browser', id: '1:p2' });

  const reloaded = layoutsOn(storage);

  expect(ids(reloaded, A)).toEqual(['file:one.ts', 'browser:1:p1', 'file:two.ts']);
  expect(reloaded.layout(A).active).toBe(page.key);
  expect(ids(reloaded, B)).toEqual(['browser:1:p2']);
});

test('opening the same thing again turns to its tab instead of a second one', () => {
  const layouts = layoutsOn();
  const first = layouts.open(A, { kind: 'file', id: 'one.ts' });
  layouts.open(A, { kind: 'file', id: 'two.ts' });

  const again = layouts.open(A, { kind: 'file', id: 'one.ts' });

  expect(again).toEqual({ kind: 'revealed', key: first.kind === 'refused' ? null : first.key });
  expect(ids(layouts, A)).toEqual(['file:one.ts', 'file:two.ts']);
  expect(layouts.layout(A).active).toBe(again.kind === 'refused' ? null : again.key);
});

test('closing the active tab returns to the tab worked in before it, across a reload, not to its neighbour', () => {
  const storage = makeStorage();
  const layouts = layoutsOn(storage);
  const changes = layouts.open(A, { kind: 'file', id: 'changes.ts' });
  layouts.open(A, { kind: 'browser', id: '1:call' });
  if (changes.kind === 'refused') throw new Error('The first tab was refused.');
  layouts.activate(A, changes.key);
  const opened = layouts.open(A, { kind: 'file', id: 'opened.ts' });
  if (opened.kind === 'refused') throw new Error('The opened tab was refused.');

  const reloaded = layoutsOn(storage);
  reloaded.close(A, opened.key);

  expect(reloaded.layout(A).active).toBe(changes.key);
});

test('a tab opened in the background into an empty layout leaves the area closed', () => {
  const layouts = layoutsOn();

  layouts.open(A, { kind: 'browser', id: '1:p1' }, { activate: false, agent: true });

  expect(ids(layouts, A)).toEqual(['browser:1:p1']);
  expect(layouts.layout(A).open).toBe(false);
});

test('a thread is refused as a tab of its own layout', () => {
  const layouts = layoutsOn();
  const t1 = held('t1');

  expect(layouts.open(t1, { kind: 'thread', id: 't1' })).toEqual({ kind: 'refused', reason: 'inadmissible' });
  expect(layouts.open(t1, { kind: 'thread', id: 't2' }).kind).toBe('opened');
  expect(ids(layouts, t1)).toEqual(['thread:t2']);
});

test('a draft’s tabs go to the thread born from it', () => {
  const storage = makeStorage();
  const layouts = layoutsOn(storage);
  const draft = draftHolder(1);
  const born = held('born');
  layouts.open(draft, { kind: 'file', id: 'one.ts' });

  layouts.carry(draft, born);

  expect(ids(layouts, born)).toEqual(['file:one.ts']);
  expect(ids(layouts, draft)).toEqual([]);
  expect(ids(layoutsOn(storage), born)).toEqual(['file:one.ts']);
});

test('the start sweep drops layouts unused past the age limit and the oldest past the holder limit', () => {
  const storage = makeStorage();
  let now = 0;
  const layouts = layoutsOn(storage, () => now);
  now = 1;
  layouts.open(held('stale'), { kind: 'file', id: 'x' });
  for (let holder = 0; holder <= KEPT_HOLDERS; holder++) {
    now = (KEPT_DAYS + 1) * DAY_MS + holder;
    layouts.open(held(`t${holder}`), { kind: 'file', id: 'x' });
  }

  const swept = layoutsOn(storage, () => now + DAY_MS);

  expect(ids(swept, held('stale'))).toEqual([]);
  expect(ids(swept, held('t0'))).toEqual([]);
  expect(ids(swept, held('t1'))).toEqual(['file:x']);
  expect(storage.keys('tagma.tabs:1:')).toHaveLength(KEPT_HOLDERS);
});

test('tabs saved under the former plugin kind and section reload as app tabs of the app section, stored under its new key', () => {
  const storage = makeStorage();
  const tabs = [
    { key: 'k1', kind: 'plugin', id: 'crm/board' },
    { key: 'k2', kind: 'file', id: 'one.ts' },
  ];
  storage.setItem(
    'tagma.tabs:1:section:plugin/crm/deals',
    JSON.stringify({ tabs, active: 'k1', open: true, recent: [], at: 1_000 * DAY_MS }),
  );
  storage.setItem('tagma.tabs:1:a', JSON.stringify({ tabs: [tabs[0]], active: 'k1', open: true, recent: [], at: 1_000 * DAY_MS }));

  const layouts = layoutsOn(storage);

  expect(ids(layouts, sectionHolder('app/crm/deals'))).toEqual(['app:crm/board', 'file:one.ts']);
  expect(layouts.layout(sectionHolder('app/crm/deals')).active).toBe('k1');
  expect(ids(layouts, A)).toEqual(['app:crm/board']);
  expect(storage.keys('tagma.tabs:1:').toSorted()).toEqual(['tagma.tabs:1:a', 'tagma.tabs:1:section:app/crm/deals']);
});

test('writing one thread’s layout leaves another thread’s stored layout as it was', () => {
  const storage = makeStorage();
  const layouts = layoutsOn(storage);
  layouts.open(B, { kind: 'file', id: 'b.ts' });
  const before = storage.getItem('tagma.tabs:1:b');

  layouts.open(A, { kind: 'file', id: 'a.ts' });
  layouts.show(A, false);

  expect(storage.getItem('tagma.tabs:1:b')).toBe(before);
});
