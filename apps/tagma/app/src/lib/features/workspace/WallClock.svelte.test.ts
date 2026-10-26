// @vitest-environment jsdom
import { Scope } from '@runlith/layer/Scope';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WallClock } from './WallClock.svelte.js';

const START = Date.UTC(2026, 9, 10, 17, 0, 0);
let scope: Scope;

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  scope = Scope.make();
});

afterEach(async () => {
  await scope.close();
  vi.useRealTimers();
});

test('a timer firing before the wall clock reached a deadline never leaves now short of it', () => {
  const clock = new WallClock(scope);
  const at = START + 3_000;
  clock.watchDeadline(at);

  vi.setSystemTime(START - 10);
  vi.advanceTimersByTime(3_000);
  expect(clock.now).toBeLessThan(at);

  vi.advanceTimersByTime(10);
  expect(clock.now).toBeGreaterThanOrEqual(at);
});

test('a deadline the wall clock passed while timers stood still settles on return to the window, or within the recheck', () => {
  const clock = new WallClock(scope);
  const first = START + 5 * 60_000;
  clock.watchDeadline(first);
  vi.setSystemTime(START + 40 * 60_000);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(clock.now).toBeGreaterThanOrEqual(first);

  const second = START + 45 * 60_000;
  clock.watchDeadline(second);
  vi.setSystemTime(START + 90 * 60_000);
  vi.advanceTimersByTime(5_000);
  expect(clock.now).toBeGreaterThanOrEqual(second);
});

test('a deadline stands while any watch holds it, and nothing moves the clock once the last watch or the scope is gone', async () => {
  const clock = new WallClock(scope);
  const at = START + 60_000;
  const first = clock.watchDeadline(at);
  clock.watchDeadline(at);
  first();
  vi.advanceTimersByTime(60_000);
  expect(clock.now).toBeGreaterThanOrEqual(at);

  const released = new WallClock(scope);
  const before = released.now;
  released.watchDeadline(START + 120_000)();
  vi.setSystemTime(START + 180_000);
  vi.advanceTimersByTime(5_000);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(released.now).toBe(before);

  const closing = Scope.make();
  const closed = new WallClock(closing);
  const shown = closed.now;
  closed.watchDeadline(START + 300_000);
  await closing.close();
  vi.setSystemTime(START + 400_000);
  vi.advanceTimersByTime(5_000);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(closed.now).toBe(shown);
});
