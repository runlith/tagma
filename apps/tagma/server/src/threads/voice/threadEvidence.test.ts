import { expect, test } from 'bun:test';
import type { EvidenceAnswer } from '../contract/wire/evidence.js';
import { evidenceText } from './threadText.js';

const answer = (over: Partial<EvidenceAnswer>): EvidenceAnswer => ({
  select: 'steps',
  threads: [{ threadId: 'thread-1', head: 10 }],
  over: 1,
  rows: [],
  coverage: { complete: true, unavailable: [], truncated: false, read: 0 },
  cursor: null,
  ...over,
});

test('a continuation is shown whenever there is one, whole population or not', () => {
  const ranked = evidenceText(
    answer({
      rows: [{ at: 3, 'usage.totalTokens': 50 }],
      coverage: { complete: true, unavailable: [], truncated: true, read: 5 },
      cursor: 'CURSOR-ONE',
    }),
  );
  expect(ranked).toContain('more · cursor CURSOR-ONE');

  const grouped = evidenceText(
    answer({
      groups: [{ by: { model: 'claude-opus-5-5' }, count: 2 }],
      coverage: { complete: true, unavailable: [], truncated: true, read: 5 },
      cursor: 'CURSOR-TWO',
    }),
  );
  expect(grouped).toContain('more · cursor CURSOR-TWO');
});

test('incomplete coverage without a cursor offers no continuation', () => {
  const held = evidenceText(
    answer({
      rows: [{ at: 1 }],
      coverage: { complete: false, unavailable: ['run-7'], truncated: false, read: 1 },
      cursor: null,
    }),
  );
  expect(held).toContain('unavailable: 1');
  expect(held).not.toContain('more · cursor');
});

test('group keys keep their types, and an absent path is its own group', () => {
  const text = evidenceText(
    answer({
      groups: [
        { by: { flag: true }, count: 1 },
        { by: { flag: 'true' }, count: 2 },
        { by: { flag: null }, count: 3 },
        { by: { shape: { of: 'a' } }, count: 4 },
        { by: { shape: { of: 'b' } }, count: 5 },
        { by: {}, absent: ['flag'], count: 6 },
      ],
      coverage: { complete: true, unavailable: [], truncated: false, read: 21 },
    }),
  );
  const lines = text.split('\n').filter((line) => line.startsWith('  '));
  expect(lines).toEqual([
    '  flag=true · 1',
    '  flag="true" · 2',
    '  flag=null · 3',
    '  shape={"of":"a"} · 4',
    '  shape={"of":"b"} · 5',
    '  flag=(absent) · 6',
  ]);
  expect(new Set(lines).size).toBe(6);
});
