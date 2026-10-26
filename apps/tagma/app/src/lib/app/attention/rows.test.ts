import type { AttentionRow } from '@tagma/server/threads/contract/wire/attention';
import { expect, test } from 'vitest';
import type { Notification } from '@tagma/server/notify/contract/wire/notification';
import { applyAttention, applyNotifications, countsOf, groupsOf, NONE, notificationCountsOf } from './rows.js';

const row = (threadId: string, kind: AttentionRow['kind'], at: string): AttentionRow => ({
  project: { id: 5, name: 'runlith' },
  threadId,
  title: threadId,
  name: null,
  parentId: null,
  kind,
  eventId: `${threadId}:${kind}`,
  at,
  runId: kind === 'awaiting' ? null : `run-${threadId}`,
  ask: kind === 'awaiting' ? { questionId: 'q', text: 'which?', kind: 'question', options: [] } : null,
  said: null,
  failure: null,
});

test('a list replaces the held rows, newest first, and the change events keep the set in step', () => {
  const listed = applyAttention(NONE, {
    type: 'list',
    rows: [row('a', 'finished', '2026-10-04T10:00:00.000Z'), row('b', 'awaiting', '2026-10-04T12:00:00.000Z')],
    total: 2,
  });
  expect(listed.rows.map((held) => held.threadId)).toEqual(['b', 'a']);

  const changed = applyAttention(listed, {
    type: 'change',
    rows: [row('a', 'failed', '2026-10-04T13:00:00.000Z'), row('c', 'finished', '2026-10-04T11:00:00.000Z')],
    removed: ['b'],
    total: 2,
  });
  expect(changed.rows.map((held) => `${held.threadId}:${held.kind}`)).toEqual(['a:failed', 'c:finished']);
  expect(changed.total).toBe(2);

  const relisted = applyAttention(changed, { type: 'list', rows: [], total: 0 });
  expect(relisted).toEqual(NONE);
});

test('counts and groups separate what needs the operator from what only finished', () => {
  const rows = [
    row('a', 'awaiting', '2026-10-04T12:00:00.000Z'),
    row('b', 'failed', '2026-10-04T11:00:00.000Z'),
    row('c', 'finished', '2026-10-04T10:00:00.000Z'),
  ];
  expect(countsOf(rows)).toEqual({ awaiting: 1, failed: 1, finished: 1 });
  expect(groupsOf(rows).map((group) => group.kind)).toEqual(['awaiting', 'failed', 'finished']);
  expect(groupsOf([rows[2]!]).map((group) => group.kind)).toEqual(['finished']);
});

const notice = (id: string, at: string, asks: boolean): Notification => ({
  id,
  sender: 'plugin:poker',
  title: id,
  body: '',
  at,
  question: asks ? { text: 'Raise?', options: [] } : null,
});

test('notifications keep newest first as the feed lists, puts and removes them', () => {
  const listed = applyNotifications([], {
    type: 'list',
    rows: [notice('a', '2026-10-04T10:00:00.000Z', false), notice('b', '2026-10-04T12:00:00.000Z', true)],
  });
  expect(listed.map((held) => held.id)).toEqual(['b', 'a']);
  const put = applyNotifications(listed, { type: 'put', row: notice('a', '2026-10-04T13:00:00.000Z', true) });
  expect(put.map((held) => held.id)).toEqual(['a', 'b']);
  const gone = applyNotifications(put, { type: 'gone', id: 'b' });
  expect(gone.map((held) => held.id)).toEqual(['a']);
  expect(notificationCountsOf(put)).toEqual({ asking: 2, telling: 0 });
  expect(notificationCountsOf(listed)).toEqual({ asking: 1, telling: 1 });
});
