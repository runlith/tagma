import { expect, test } from 'bun:test';
import { Pending } from './pending.js';

test('an unnamed refs rescan discards named tree paths and carries the full rescan to its subscriber', () => {
  const pending = new Pending(2);
  pending.add({ movement: 'tree', paths: ['known.txt'] });
  pending.add({ movement: 'refs', rescan: 'unnamed' });
  expect(pending.take()).toEqual({ movements: ['tree', 'refs'], paths: new Map(), rescan: 'unnamed' });
  expect(pending.take()).toBeNull();
});
