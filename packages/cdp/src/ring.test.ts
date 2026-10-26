import { expect, test } from 'bun:test';
import { Ring } from './ring.js';

test('the ring keeps the newest entries within its byte limit, counts what it let go, and reads past a seq with a total', () => {
  const ring = new Ring<string>(9, (entry) => entry.length);
  for (const entry of ['aaaa', 'bbbb', 'cccc', 'dd']) ring.push(entry);
  const all = ring.read({ limit: 10 });
  expect(all.entries.map((held) => held.entry)).toEqual(['cccc', 'dd']);
  expect(all.dropped).toBe(2);
  const later = ring.read({ limit: 1, after: 3 });
  expect(later).toEqual({ entries: [{ seq: 4, entry: 'dd' }], total: 1, dropped: 2 });
  const capped = ring.read({ limit: 1 });
  expect(capped.entries.map((held) => held.entry)).toEqual(['dd']);
  expect(capped.total).toBe(2);
});
