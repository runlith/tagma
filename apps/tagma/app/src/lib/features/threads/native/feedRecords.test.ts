import { expect, test } from 'vitest';
import { feedRecord } from './feedRecords.js';
import { transportSwitchId } from '../external/productRecords.js';

test('a decoded transport switch reaches the feed as its own record', () => {
  const entry = { type: 'transport', id: 'transport:1', from: 'terminal', to: 'acp', occurredAt: '2026-10-05T10:00:00.000Z' };
  expect(feedRecord(entry)).toEqual([
    { id: 'transport:1', kind: 'product', product: transportSwitchId.product, payload: entry, occurredAt: '2026-10-05T10:00:00.000Z' },
  ]);
});
