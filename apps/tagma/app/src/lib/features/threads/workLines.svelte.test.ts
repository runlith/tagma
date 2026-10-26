// @vitest-environment jsdom

import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import type { WorkInput } from './workLine.js';
import { WorkLines } from './workLines.svelte.js';

class FakeClock {
  now = $state(0);
  watching = 0;
  watch(): () => void {
    this.watching += 1;
    return () => (this.watching -= 1);
  }
}

const input = (phase: WorkInput['phase'], ...calls: readonly string[]): WorkInput => ({
  phase,
  since: null,
  calls: calls.map((name) => ({ name, title: `${name} a.ts`, since: 0 })),
  queued: 0,
});

let leave: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  leave?.();
  leave = undefined;
  vi.useRealTimers();
});

function open(): { lines: WorkLines; clock: FakeClock } {
  const clock = new FakeClock();
  let lines!: WorkLines;
  leave = $effect.root(() => {
    lines = new WorkLines(clock as unknown as WallClock);
  });
  return { lines, clock };
}

test('a shown line holds for the dwell and gives way on the first clock tick after it, held by the list alone', () => {
  const { lines, clock } = open();
  lines.follow('a', input('tools', 'edit'));
  flushSync();
  expect(lines.shown('a')?.text).toBe('edit a.ts');
  expect(clock.watching).toBe(1);

  vi.setSystemTime(200);
  lines.follow('a', input('reasoning'));
  expect(lines.shown('a')?.text).toBe('edit a.ts');

  vi.setSystemTime(1_200);
  clock.now = 1_200;
  flushSync();
  expect(lines.shown('a')?.view.kind).toBe('phase');
});

test('a thread that stops working or leaves the list loses its line and stops holding the clock', () => {
  const { lines, clock } = open();
  lines.follow('a', input('tools', 'edit'));
  lines.follow('b', input('tools', 'read'));
  flushSync();

  lines.follow('a', null);
  expect(lines.shown('a')).toBeNull();
  lines.release('b');
  flushSync();
  expect(lines.shown('b')).toBeNull();
  expect(clock.watching).toBe(0);
});
