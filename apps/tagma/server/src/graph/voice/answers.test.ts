import { expect, test } from 'bun:test';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { ToolJournal } from '../contract/wire/toolAnswers.js';
import { graphText } from './answers.js';
import { graphSettledDisplay } from './display.js';

test('journal acts keep their event positions when writer metadata or the block row is unavailable', () => {
  const firstTs = '2026-10-01T09:00:00Z';
  const lastTs = '2026-10-01T10:00:00Z';
  const answer: ToolJournal = {
    status: 'ok',
    blocks: [],
    sessions: [{ id: 8337742, harness: 'claude-code', key: 'reader-opaque-key', title: null, name: null }],
    nextBefore: null,
    batches: [
      {
        blockName: 'abcd1234',
        sessionId: 8772641,
        ops: ['create', 'update'],
        entries: 2,
        firstEventId: 234567,
        lastEventId: 234568,
        firstTs,
        lastTs,
      },
      { blockName: '', sessionId: null, ops: ['delete'], entries: 1, firstEventId: 234566, lastEventId: 234566, firstTs, lastTs: firstTs },
      {
        blockName: 'abcd1234',
        sessionId: 8337742,
        ops: ['claim'],
        entries: 1,
        firstEventId: 234565,
        lastEventId: 234565,
        firstTs,
        lastTs: firstTs,
      },
    ],
  };
  const text = graphText({} as TagTable, answer, testSessionIdentity, 'read_journal') ?? '';
  for (const value of [
    'abcd1234',
    '8772641',
    '8337742',
    'claude-code:reader-opaque-key',
    '234567',
    '234568',
    '234566',
    firstTs,
    lastTs,
    'create',
    'update',
    'delete',
  ])
    expect(text).toContain(value);
  expect(text.indexOf('234567')).toBeLessThan(text.indexOf('234566'));
  expect(graphSettledDisplay({}, answer).facts?.map(({ value }) => value)).toEqual(['3']);
});

test('an empty journal page reports zero batches without borrowing a block-list total', () => {
  const answer: ToolJournal = { status: 'ok', batches: [], blocks: [], sessions: [], nextBefore: null };
  expect(graphSettledDisplay({}, answer).facts?.map(({ value }) => value)).toEqual(['0']);
});

test('a landed block keeps the journal read failure visible', () => {
  const display = graphSettledDisplay(
    {},
    {
      status: 'ok',
      block: {
        name: 'abcd1234',
        identity: '000000000000000000000000abcd1234',
        tags: [],
        fields: {},
        actions: { moves: [], slots: [], offers: [], revision: 'test' },
        title: 'Written',
        parentName: null,
        superseded: false,
        blocked: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      journalUnreadable: 'journal-unreadable',
    },
  );
  expect(display.facts?.find((fact) => fact.label === 'journal')?.value).toBe('unreadable: journal-unreadable');
});
