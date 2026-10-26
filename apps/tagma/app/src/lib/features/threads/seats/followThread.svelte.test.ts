// @vitest-environment jsdom
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { makeStorage } from '@runlith/layer/testing';
import { stubMutation } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import { testThreadChat, testThreadSlot } from '$lib/app/slotWorld.js';
import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
import { followThread } from './followThread.svelte.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { THREAD_PANE } from './pane.js';
import { ThreadSeats } from './ThreadSeats.svelte.js';

function paneSlot(opening: string | null, over: Parameters<typeof testThreadSlot>[0] = {}) {
  const { panes } = testArea([testKind(THREAD_PANE)], makeStorage());
  const seats = new ThreadSeats(panes);
  panes.showSection('chat');
  const opened = panes.open({ kind: THREAD_PANE, id: opening });
  if (opened.kind === 'refused') throw new Error('No pane opened.');
  const key = opened.key;
  const slot = testThreadSlot({ projectId: 1, ...over }, { writer: seats.writerOf(key) });
  const stop = $effect.root(() =>
    followThread(seats, () => panes.panes.find((pane) => pane.key === key) ?? { key, kind: THREAD_PANE, id: null }, slot, 1),
  );
  return { panes, seats, key, slot, stop };
}

const held = (slot: ThreadSlot): string | null => slot.activeId;

test('a slot in a pane shows the thread its pane holds, however the pane is moved, and a draft started in it empties the pane', () => {
  const { panes, seats, key, slot, stop } = paneSlot('a');

  expect(held(slot)).toBe('a');

  slot.open('b');
  flushSync();
  expect(held(slot)).toBe('b');
  expect(panes.panes.map((pane) => pane.id)).toEqual(['b']);

  seats.writerOf(key).navigate('c');
  seats.writerOf(key).navigate('d');
  flushSync();
  expect(held(slot)).toBe('d');

  slot.startDraft();
  flushSync();
  expect(held(slot)).toBeNull();
  expect(panes.panes.map((pane) => pane.id)).toEqual([null]);

  stop();
});

test('a draft started as another agent in a pane keeps its type until the pane has committed the draft selection', () => {
  const { slot, stop } = paneSlot('a');

  slot.startDraftAs('code');
  expect(held(slot)).toBe('a');
  flushSync();

  expect(held(slot)).toBeNull();
  expect(slot.draft.type).toBe('code');

  stop();
});

test('a thread born in a pane is shown once the pane holds it, and the pane keeps it', async () => {
  const port = new TestConnection<WireThread>();
  const { panes, slot, stop } = paneSlot(null, {
    chat: testThreadChat(port),
    threads: { create: stubMutation(async () => ({ snapshot: { thread: { id: 'born' } } })) },
  });
  slot.draft.setText('first words');

  expect(await slot.writes.send()).toBe(true);
  flushSync();

  expect(held(slot)).toBe('born');
  expect(panes.panes.map((pane) => pane.id)).toEqual(['born']);

  stop();
});
