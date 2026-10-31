import { expect, test } from 'vitest';
import { recordOf } from './records.js';
import { testRecords } from './testing.js';

test('a decoded transport switch reaches the feed as its own record', () => {
  const entry = { type: 'transport', id: 'transport:1', from: 'terminal', to: 'acp', occurredAt: '2026-10-05T10:00:00.000Z' };
  expect(recordOf(testRecords(), entry)).toEqual([
    { id: 'transport:1', kind: 'product', product: 'transport-switch', payload: entry, occurredAt: '2026-10-05T10:00:00.000Z' },
  ]);
});
