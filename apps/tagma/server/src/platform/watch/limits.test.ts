import { expect, test } from 'bun:test';
import { watchBudget } from './limits.js';

test('the watch budget reserves twenty percent of descriptors and those already open', () => {
  expect(watchBudget({ soft: 1024, opened: 100, inotify: null })).toBe(719);
  expect(watchBudget({ soft: 64, opened: 60, inotify: null })).toBe(0);
});

test('Linux watch descriptors and unmeasured limits bound admission', () => {
  expect(watchBudget({ soft: 4096, opened: 200, inotify: 128 })).toBe(128);
  expect(watchBudget({ soft: 0, opened: 0, inotify: null })).toBe(0);
  expect(watchBudget({ soft: 4096, opened: 0, inotify: 0 })).toBe(0);
});
