import type { Resolver } from '@runlith/layer/key';
import { makeStorage } from '@runlith/layer/testing';
import { RegistryClash } from '@runlith/chat-ui/RegistryClash';
import { expect, test } from 'vitest';
import type { PaneKind } from '$lib/shared/panes/pane.js';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { AreaFrame, MAIN_MIN } from './AreaFrame.svelte.js';
import { PaneRegistry } from './PaneRegistry.js';
import type { MainSeat, SidePanes } from './SidePanes.svelte.js';
import { testArea, testKind } from './testing.js';

const KINDS: PaneKind[] = [testKind('thread'), { ...testKind('browser'), portable: true }, testKind('sketch')];

const slot = (activeId: string | null): MainSeat => ({ activeId, projectId: 1 });

const shown = (panes: SidePanes) => panes.panes.map((pane) => `${pane.kind}:${pane.id}`);

test('each thread shown as main brings back its own tabs', () => {
  const { panes } = testArea(KINDS);
  panes.seatMain(slot('a'));
  panes.open({ kind: 'browser', id: '1:p1' });
  panes.seatMain(slot('b'));
  expect(shown(panes)).toEqual([]);
  panes.open({ kind: 'sketch', id: 's1' });

  panes.seatMain(slot('a'));

  expect(shown(panes)).toEqual(['browser:1:p1']);
});

test('a tab of any kind a feature declares opens, and is restored, without the container knowing it', () => {
  const storage = makeStorage();
  const { panes } = testArea(KINDS, storage);
  panes.showSection('graph');
  panes.open({ kind: 'sketch', id: 'drawing' });

  const reloaded = testArea(KINDS, storage).panes;
  reloaded.showSection('graph');

  expect(shown(reloaded)).toEqual(['sketch:drawing']);
  expect(panes.open({ kind: 'ghost', id: 'x' })).toEqual({ kind: 'refused', reason: 'undeclared' });
});

test('a tab whose owner takes its closing stays until the owner lets it go, and a thing its owner says is gone leaves the area', () => {
  let ending: string | null = null;
  let standing = $state(true);
  const owned: PaneKind = {
    ...testKind('shell'),
    close: (_app, id) => {
      ending = id;
      return true;
    },
    stands: () => standing,
  };
  const { panes } = testArea([owned], makeStorage(), {} as Resolver);
  panes.seatMain(slot('a'));
  const opened = panes.open({ kind: 'shell', id: 's1' });
  if (opened.kind === 'refused') throw new Error('No tab opened.');

  panes.close(opened.key);
  expect(ending).toBe('s1');
  expect(shown(panes)).toEqual(['shell:s1']);

  standing = false;
  expect(shown(panes)).toEqual([]);
});

test('a toggle closes the tab it shows and opens it again', () => {
  const { panes } = testArea(KINDS);
  panes.seatMain(slot('a'));
  const call = { kind: 'sketch', id: 's1' };

  panes.toggle(call);
  expect(panes.active?.id).toBe('s1');
  panes.toggle(call);

  expect(panes.panes).toEqual([]);
});

test('the area has one width the operator drags, kept across a reload and held inside the room the conversation leaves', () => {
  const storage = makeStorage();
  const frame = new AreaFrame(new Seams(storage));
  frame.resize(512);

  const reloaded = new AreaFrame(new Seams(storage));
  expect(reloaded.width).toBe(512);
  reloaded.measure(512 + MAIN_MIN);
  expect(reloaded.room).toBe(512);
});

test('two kinds claiming one name refuse at assembly', () => {
  expect(() => new PaneRegistry([testKind('thread'), testKind('thread')])).toThrow(RegistryClash);
});
