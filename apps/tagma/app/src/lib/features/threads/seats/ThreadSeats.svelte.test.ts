import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { PaneRegistry } from '$lib/app/panes/PaneRegistry.js';
import type { MainSeat, SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { TabLayouts } from '$lib/app/panes/TabLayouts.svelte.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { SurfaceRegistry } from '$lib/features/workspace/surface.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import type { PaneKind } from '$lib/shared/panes/pane.js';
import { ThreadSeats } from './ThreadSeats.svelte.js';

const KINDS: PaneKind[] = [testKind('thread'), { ...testKind('browser'), portable: true }, testKind('sketch')];

const slot = (activeId: string | null): MainSeat => ({ activeId, projectId: 1 });

const shown = (panes: SidePanes) => panes.panes.map((pane) => `${pane.kind}:${pane.id}`);

test('a thread opened beside that the main slot shows is revealed there and takes no tab', () => {
  const { panes } = testArea(KINDS);
  const seats = new ThreadSeats(panes);
  panes.seatMain(slot('main-thread'));

  expect(seats.open({ home: null, threadId: 'main-thread' }).kind).toBe('main');
  expect(panes.panes).toEqual([]);
  expect(seats.mainFocused).toBe(true);
});

test('a page an agent opens lands without focus in the layout of the screen that shows its thread, or in the thread’s own', () => {
  const { panes, layouts } = testArea(KINDS);
  const seats = new ThreadSeats(panes);
  panes.seatMain(slot('lead'));
  panes.open({ kind: 'thread', id: 'sub' });
  panes.focusOn(null);

  seats.openFor(layouts, 'sub', { kind: 'browser', id: '1:p1' }, { activate: false, agent: true });
  seats.openFor(layouts, 'elsewhere', { kind: 'browser', id: '1:p2' }, { activate: false, agent: true });

  expect(shown(panes)).toEqual(['thread:sub', 'browser:1:p1']);
  expect(panes.active?.kind).toBe('thread');
  expect(panes.panes.at(-1)?.agent).toBe(true);
  expect(seats.mainFocused).toBe(true);
  expect(layouts.layout(threadHolder('elsewhere')).tabs.map((tab) => tab.id)).toEqual(['1:p2']);
});

test('a page of another project’s agent lands in the screen that shows that agent as a tab', () => {
  const { panes } = testArea(KINDS);
  const seats = new ThreadSeats(panes);
  const home = new TabLayouts(2, makeStorage(), new PaneRegistry(KINDS), new SurfaceRegistry([]), () => 1);
  panes.seatMain(slot('lead'));
  panes.open({ kind: 'thread', id: '2:sub' });

  seats.openFor(home, 'sub', { kind: 'browser', id: '2:p1' }, { activate: false, agent: true });

  expect(shown(panes)).toEqual(['thread:2:sub', 'browser:2:p1']);
  expect(home.layout(threadHolder('sub')).tabs).toEqual([]);
});
