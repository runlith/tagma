import { expect, test } from 'vitest';
import { pageOf } from '../testing/page.js';
import { adapterOf } from './adapter.js';

test('a page shows natively only where its host is the bridge of this desktop, and by screencast everywhere else', () => {
  expect(adapterOf(pageOf('a', { host: 'desktop-1' }), 'desktop-1')).toBe('native');
  expect(adapterOf(pageOf('b', { host: 'desktop-2' }), 'desktop-1')).toBe('cast');
  expect(adapterOf(pageOf('c', { host: 'managed' }), 'desktop-1')).toBe('cast');
  expect(adapterOf(pageOf('d', { host: null, state: 'dormant' }), 'desktop-1')).toBe('cast');
  expect(adapterOf(pageOf('e', { host: 'desktop-1' }), null)).toBe('cast');
});
