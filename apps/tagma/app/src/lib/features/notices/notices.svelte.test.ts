// @vitest-environment jsdom
import { Scope } from '@runlith/layer/Scope';
import { afterEach, expect, test, vi } from 'vitest';
import { Refusal } from '$lib/wire/refusal.js';
import { Notices } from './Service.svelte.js';

afterEach(() => {
  vi.useRealTimers();
});

test('an undo card leaves by itself after eight seconds, and the error beside it stays', () => {
  vi.useFakeTimers();
  const notices = new Notices(Scope.make());

  notices.error('Request failed', 'the door answered nothing');
  notices.undoable('Deleted a.ts', () => undefined);
  vi.advanceTimersByTime(7_999);
  expect(notices.list.map((notice) => notice.kind)).toEqual(['error', 'undo']);

  vi.advanceTimersByTime(1);
  expect(notices.list.map((notice) => notice.kind)).toEqual(['error']);
});

test('a fourth undo pushes the oldest one off, and three stay', () => {
  const notices = new Notices(Scope.make());

  for (const name of ['a', 'b', 'c', 'd']) notices.undoable(`Deleted ${name}`, () => undefined);

  expect(notices.list.map((notice) => notice.title)).toEqual(['Deleted b', 'Deleted c', 'Deleted d']);
});

test('a lifetime closing takes its undo cards and leaves the rest of the column standing', async () => {
  const app = Scope.make();
  const notices = new Notices(app);
  const surface = app.child('surface');

  notices.error('Request failed', 'the door answered nothing');
  notices.undoable('Deleted “A” · aaaa1111', () => undefined, surface);
  expect(notices.list.map((notice) => notice.kind)).toEqual(['error', 'undo']);

  await surface.close();

  expect(notices.list.map((notice) => notice.kind)).toEqual(['error']);
});

test('a refusal whose code the composition offers for becomes an offer carrying that act; any other refusal stays a refusal', () => {
  const get = { label: 'Get', run: () => undefined };
  const notices = new Notices(Scope.make(), { code: 'unavailable', act: get });
  const refused = (code: string, text: string) =>
    new Refusal({ gate: true, code, reason: 'no answer recorded', unblock: [], words: { text } });

  notices.refusal(refused('unavailable', 'Terminals need the app'));
  notices.refusal(refused('unavailable', 'Opening in an editor needs the app'));
  notices.refusal(refused('editor-missing', 'Cursor is not installed'));

  expect(notices.list.map((notice) => [notice.kind, notice.told?.text, notice.told?.act])).toEqual([
    ['offer', 'Terminals need the app', get],
    ['offer', 'Opening in an editor needs the app', get],
    ['refusal', 'Cursor is not installed', undefined],
  ]);
});

test('a card raised under a lifetime already closed is not put on screen at all', () => {
  const app = Scope.make();
  const notices = new Notices(app);
  const surface = app.child('surface');
  void surface.close();

  notices.undoable('Deleted “A” · aaaa1111', () => undefined, surface);

  expect(notices.list).toEqual([]);
});
