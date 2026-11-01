import { expect, test } from 'bun:test';
import { workOf, working } from './server.js';

const answer = (server: Record<string, unknown>) => ({
  machine: {
    server: { agents: 0, next: { installing: null }, ...server },
    host: { holds: { terminals: 0, commands: 0 } },
    restart: { stage: null },
  },
});

test('a server listing its live work is idle only when every count is zero, and its words come from the list', () => {
  const quiet = workOf(answer({ calls: 0, work: [{ id: 'tones', count: 0, one: 'tone ends', many: 'tones end' }] }));
  const busy = workOf(answer({ calls: 2, work: [{ id: 'tones', count: 2, one: 'tone ends', many: 'tones end' }] }));
  expect(quiet !== null && working(quiet)).toBe(false);
  expect(busy !== null && working(busy)).toBe(true);
  expect(busy?.live).toEqual([{ count: 2, one: 'tone ends', many: 'tones end' }]);
});

test('a server of an earlier release, answering only its total, is judged by that total', () => {
  const quiet = workOf(answer({ calls: 0 }));
  const busy = workOf(answer({ calls: 1 }));
  const silent = workOf(answer({}));
  expect(quiet !== null && working(quiet)).toBe(false);
  expect(busy !== null && working(busy)).toBe(true);
  expect(silent !== null && working(silent)).toBe(true);
});
