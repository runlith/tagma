import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThreadPeeks } from './threadPeek.svelte.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a hover opens the peek only after it rests, and leaving the row before then opens nothing', () => {
  const peeks = new ThreadPeeks();
  peeks.hover('a');
  vi.advanceTimersByTime(200);
  peeks.leave('a');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();

  peeks.hover('a');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe('a');
});

test('a hovered peek survives the pointer crossing from the row onto it, and closes once the pointer leaves both', () => {
  const peeks = new ThreadPeeks();
  peeks.hover('a');
  vi.advanceTimersByTime(1000);

  peeks.leave('a');
  peeks.hold();
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe('a');

  peeks.leave('a');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();
});

test('a hovered peek still closes when the pointer crosses another row on its way off the list', () => {
  const peeks = new ThreadPeeks();
  peeks.hover('a');
  vi.advanceTimersByTime(1000);

  peeks.leave('a');
  peeks.hover('b');
  vi.advanceTimersByTime(100);
  peeks.leave('b');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();
});

test('a press closes the peek, and the pointer resting on that thread opens none until it leaves and comes back', () => {
  const peeks = new ThreadPeeks();
  const row = peeks.key('thread-1');
  peeks.hover(row);
  vi.advanceTimersByTime(1000);
  peeks.press(row);
  expect(peeks.openId).toBeNull();

  const redrawn = peeks.key('thread-1');
  peeks.hover(redrawn);
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();

  peeks.leave(redrawn);
  peeks.hover(redrawn);
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe(redrawn);
});

test('a press before the hover rests cancels the pending peek, and another thread still opens its own', () => {
  const peeks = new ThreadPeeks();
  const pressed = peeks.key('thread-1');
  peeks.hover(pressed);
  vi.advanceTimersByTime(200);
  peeks.press(pressed);
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();

  const other = peeks.key('thread-2');
  peeks.hover(other);
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe(other);
});

test('a row leaving the list before its hover rests never opens a peek', () => {
  const peeks = new ThreadPeeks();
  peeks.hover('a');
  peeks.close('a');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBeNull();
});

test('an act holds its thread across every drawing and reopening, and frees it once it settles', async () => {
  const peeks = new ThreadPeeks();
  let settle = (): void => {};
  const first = peeks.act('thread-1', 'allow', () => new Promise<void>((resolve) => (settle = resolve)));
  expect(peeks.busy('thread-1')).toBe(true);
  expect(peeks.busy('thread-2')).toBe(false);

  let second = false;
  await peeks.act('thread-1', 'deny', async () => {
    second = true;
  });
  expect(second).toBe(false);

  settle();
  await first;
  expect(peeks.busy('thread-1')).toBe(false);
});

test('Space opens the same peek at once, the pointer leaving never closes it, and Space again does', () => {
  const peeks = new ThreadPeeks();
  peeks.toggle('a');
  expect(peeks.openId).toBe('a');

  peeks.leave('a');
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe('a');

  peeks.toggle('a');
  expect(peeks.openId).toBeNull();
});

test('one peek stands at a time: another row taking it closes the first, and a stale close of the first moves nothing', () => {
  const peeks = new ThreadPeeks();
  peeks.toggle('a');
  peeks.toggle('b');
  expect(peeks.openId).toBe('b');

  peeks.close('a');
  expect(peeks.openId).toBe('b');
});

test('a popover opened by click or key keeps its place while the pointer rests on other rows, and a hover opens peeks again once it closes', () => {
  const peeks = new ThreadPeeks();
  const work = peeks.workKey('thread-1');
  peeks.toggle(work);

  peeks.hover(peeks.key('thread-2'));
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe(work);

  peeks.close(work);
  peeks.hover(peeks.key('thread-2'));
  vi.advanceTimersByTime(1000);
  expect(peeks.openId).toBe(peeks.key('thread-2'));
});

test('a peek opened by key stands for the thread across its row leaving the window and returning', () => {
  const peeks = new ThreadPeeks();
  const before = peeks.key('thread-1');
  peeks.toggle(before);

  peeks.leave(before);
  vi.advanceTimersByTime(1000);

  const after = peeks.key('thread-1');
  expect(after).toBe(before);
  expect(peeks.openId).toBe(after);
});
