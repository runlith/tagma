// @vitest-environment jsdom
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { testThreadSlot } from '$lib/app/slotWorld.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import { testShelf } from '../native/testing.js';
import type { ThreadSlot } from '../ThreadSlot.svelte.js';
import { THREAD_PANE } from './pane.js';
import { ThreadSeats } from './ThreadSeats.svelte.js';

const placedIn = (seats: ThreadSeats, shelf = testShelf()): ThreadSlot => {
  const slot: ThreadSlot = testThreadSlot({ projectId: 1, shelf }, { pane: 'placed-1', writer: seats.placedWriter(() => slot, 1) });
  slot.activateRoute('desk', 1);
  return slot;
};

test('a page the thread a plugin placed opens lands on the screen the person looks at, not in the thread’s own layout', () => {
  const { panes, layouts } = testArea([testKind(THREAD_PANE), { ...testKind('browser'), portable: true }], makeStorage());
  const seats = new ThreadSeats(panes);
  panes.seatMain({ activeId: 'lead', projectId: 1 });
  panes.open({ kind: THREAD_PANE, id: 'sub' });
  const release = seats.seatPlaced(placedIn(seats));

  seats.openFor(layouts, 'desk', { kind: 'browser', id: '1:p1' }, { activate: false, agent: true });

  expect(panes.panes.map((pane) => pane.id)).toEqual(['sub', '1:p1']);
  expect(layouts.layout(threadHolder('desk')).tabs).toEqual([]);
  release();
});

test('a new draft the placed thread starts as another agent opens beside as that agent, and the placed thread stays', () => {
  const { panes } = testArea([testKind(THREAD_PANE)], makeStorage());
  const seats = new ThreadSeats(panes);
  panes.showSection('chat');
  const shelf = testShelf();
  const placed = placedIn(seats, shelf);

  placed.startDraftAs('code');

  const opened = panes.panes.find((pane) => pane.kind === THREAD_PANE);
  if (opened === undefined) throw new Error('No pane opened beside.');
  const beside = testThreadSlot({ projectId: 1, shelf }, { pane: opened.key, writer: seats.writerOf(opened.key) });
  beside.activateRoute(null, 1);
  expect(beside.draft.type).toBe('code');
  expect(placed.activeId).toBe('desk');
});
