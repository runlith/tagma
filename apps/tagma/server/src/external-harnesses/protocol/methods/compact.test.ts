import { expect, test } from 'bun:test';
import { COMPACTED } from '@runlith/hosted-runner/wire/extensions';
import { freshRow } from '../row.js';
import { compact } from './compact.js';
import { compactionEntryId } from '@runlith/agent/transcript/entryNames';

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

test('an automatic vendor boundary does not complete a queued post-turn compaction', () => {
  const row = {
    ...freshRow('process', null, null),
    compact: { turn: 'manual-run', request: 'manual-request', ids: [], mode: 'manual' as const, noticed: false },
  };
  const automatic = compact.noticed(
    row,
    { _tag: 'Extended', id: 'auto-notice', method: COMPACTED, params: { trigger: 'auto', summary: 'automatic fold' } },
    '2026-11-01T00:00:00.000Z',
  );
  expect(automatic.boundaries[0]).toMatchObject({
    id: compactionEntryId('auto-notice'),
    mode: 'automatic',
    status: 'completed',
    summary: 'automatic fold',
  });
  expect(automatic.row.compact?.noticed).toBe(false);
  const requested = compact.noticed(
    automatic.row,
    { _tag: 'Extended', id: 'manual-notice', method: COMPACTED, params: { trigger: 'manual', summary: 'requested fold' } },
    '2026-11-01T00:00:01.000Z',
  );
  expect(requested.boundaries[0]).toMatchObject({
    id: compactionEntryId('manual-run'),
    mode: 'manual',
    status: 'completed',
    summary: 'requested fold',
  });
  expect(requested.row.compact?.noticed).toBe(true);
});
