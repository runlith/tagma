import { expect, test } from 'bun:test';
import { COMPACTED } from '@runlith/hosted-runner/wire/extensions';
import { freshRow } from '../row.js';
import { compact } from './compact.js';

test('a vendor compaction without token sizes still records its summary and leaves the sizes unknown', () => {
  const handled = compact.noticed(
    freshRow('process', null, null),
    {
      _tag: 'Extended',
      id: 'notice',
      method: COMPACTED,
      params: { trigger: 'auto', summary: 'folded history' },
    },
    '2026-10-22T00:00:00.000Z',
  );
  expect(handled.boundaries).toHaveLength(1);
  const entry = handled.boundaries[0]!;
  expect(entry).toMatchObject({ type: 'compaction', status: 'completed', mode: 'automatic', summary: 'folded history' });
  if (entry.type !== 'compaction') throw new Error('the boundary must be a compaction');
  expect(entry.receipt?.measuredTokens).toBeUndefined();
  expect(entry.receipt?.postTokens).toBeUndefined();
});
