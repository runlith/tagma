import { expect, test } from 'bun:test';
import { ThreadAudience } from './audience.js';

test('an opening keeps additions and removals delivered after its snapshot began', () => {
  const audience = new ThreadAudience();
  audience.watch(1);
  audience.include(1, ['parent', 'old']);
  const opening = audience.opening(1, true);
  audience.include(1, ['child']);
  audience.remove(1, 'old');
  expect(opening.install(['parent', 'old'])).toEqual([]);
  opening.close();
  expect([...audience.projects('parent')]).toEqual([1]);
  expect([...audience.projects('child')]).toEqual([1]);
  expect(audience.has('old')).toBe(false);
});

test('older pages add members, replacement drops them, and closing one home preserves other audiences', () => {
  const audience = new ThreadAudience();
  audience.watch(1);
  audience.watch(2);
  audience.include(1, ['root', 'child']);
  audience.include(2, ['child']);
  const older = audience.opening(1, false);
  older.install(['older']);
  older.close();
  expect([...audience.projects('older')]).toEqual([1]);
  const replacement = audience.opening(1, true);
  expect(replacement.install(['root', 'child'])).toEqual(['older']);
  replacement.close();
  expect(audience.has('older')).toBe(false);
  expect(audience.close(1)).toEqual(['root']);
  expect(audience.has('root')).toBe(false);
  expect([...audience.projects('child')]).toEqual([2]);
  expect(audience.close(2)).toEqual(['child']);
  expect(audience.has('child')).toBe(false);
});
