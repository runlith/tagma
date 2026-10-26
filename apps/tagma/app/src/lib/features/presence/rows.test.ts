import { expect, test } from 'vitest';
import type { PresenceEntry, PresenceEvent, PresenceRow, PresenceTailStep } from '@tagma/server/threads/contract/wire/presence';
import { applyPresence, type PresenceCell } from './rows.js';

const row = (threadId: string, saidLine: string | null = null): PresenceRow => ({
  threadId,
  status: { threadId, runId: null, life: 'idle', stage: null, openQuestions: [], since: null, receipts: [] },
  activeRunStartedAt: null,
  ask: null,
  saidLine,
  outcome: null,
  model: { provider: null, model: null, reasoning: null },
  archived: false,
});

const cellsOf = (...ids: string[]): Map<string, PresenceCell> =>
  new Map(ids.map((id) => [id, { row: undefined, revision: 0, missing: undefined }]));

const initial = (...entries: PresenceEntry[]): PresenceEvent => ({ type: 'initial', entries });

test('a change newer than the held revision moves only the fields it names; an older or repeated one is dropped', () => {
  const cells = cellsOf('a');
  applyPresence(cells, initial({ type: 'row', revision: 2, row: row('a', 'first') }));
  applyPresence(cells, { type: 'changed', threadId: 'a', revision: 3, fields: { saidLine: 'second' } });
  expect(cells.get('a')).toMatchObject({ row: { ...row('a'), saidLine: 'second' }, revision: 3 });
  applyPresence(cells, { type: 'changed', threadId: 'a', revision: 3, fields: { saidLine: 'again' } });
  applyPresence(cells, { type: 'changed', threadId: 'a', revision: 2, fields: { saidLine: 'older' } });
  expect(cells.get('a')?.row?.saidLine).toBe('second');
});

test('a new initial answer replaces everything held, and a missing event removes the row with its reason', () => {
  const cells = cellsOf('a', 'b');
  applyPresence(cells, initial({ type: 'row', revision: 1, row: row('a') }, { type: 'row', revision: 1, row: row('b') }));
  applyPresence(cells, { type: 'missing', threadId: 'a', reason: 'deleted' });
  expect(cells.get('a')).toEqual({ row: undefined, revision: 0, missing: 'deleted' });
  applyPresence(
    cells,
    initial({ type: 'row', revision: 5, row: row('a', 'back') }, { type: 'missing', threadId: 'b', reason: 'not-found' }),
  );
  expect(cells.get('a')).toMatchObject({ row: row('a', 'back'), revision: 5, missing: undefined });
  expect(cells.get('b')).toEqual({ row: undefined, revision: 0, missing: 'not-found' });
});

test('a tail increment extends the held tail by code points, a restart replaces it, an older revision is dropped and an end removes it', () => {
  const cells = cellsOf('a');
  applyPresence(cells, initial({ type: 'row', revision: 1, row: row('a') }));
  const tail = (revision: number, step: PresenceTailStep | null): PresenceEvent => ({ type: 'tail', threadId: 'a', revision, tail: step });
  applyPresence(cells, tail(2, { restart: true, runId: 'run', entryId: 'r1', text: '😀ab' }));
  applyPresence(cells, tail(3, { restart: false, text: 'cd', drop: 2 }));
  expect(cells.get('a')?.row?.tail).toEqual({ runId: 'run', entryId: 'r1', text: 'bcd' });
  applyPresence(cells, tail(3, { restart: false, text: 'zz', drop: 0 }));
  expect(cells.get('a')?.row?.tail?.text).toBe('bcd');
  applyPresence(cells, tail(4, { restart: true, runId: 'run', entryId: 'r2', text: 'new' }));
  expect(cells.get('a')?.row?.tail).toEqual({ runId: 'run', entryId: 'r2', text: 'new' });
  applyPresence(cells, tail(5, null));
  expect(cells.get('a')?.row).not.toHaveProperty('tail');
});
