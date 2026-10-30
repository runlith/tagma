import { expect, test } from 'bun:test';
import { cursorTerminal } from './cursor.js';

const reader = cursorTerminal.metadata!;

test('the Cursor title comes from the terminal title and an unset title remains absent', () => {
  const [title] = reader.sources({ cwd: '/work', rootKey: 'cursor-title', storage: { entries: [] } });
  if (title === undefined || title.kind !== 'terminal') throw new Error('expected a terminal source');
  expect(title.cells).toBe(false);
  expect(title.parse({ title: 'Devin · my task' })).toEqual({
    value: 'Devin · my task',
    claim: 'last-recorded',
    turnId: null,
  });
  expect(title.parse({ title: '' })).toBeNull();
});

const text = (value: string) => [{ type: 'text', text: value }];
const user = { role: 'user', message: { content: text('<user_query>go</user_query>') } };
const answer = (value: string) => ({ role: 'assistant', message: { content: text(value) } });
const endOf = (records: readonly unknown[]) => reader.ends!.reader.judge([...records].reverse(), true, null);

test('Cursor turn endings distinguish success, interruption, failure and unfinished tools', () => {
  expect(endOf([user, answer('APPLE'), { type: 'turn_ended', status: 'success' }])).toEqual({ _tag: 'Completed', message: 'APPLE' });
  expect(endOf([user, { type: 'turn_ended', status: 'aborted', error: 'User aborted/interrupted manually.' }])).toEqual({
    _tag: 'Aborted',
  });
  expect(endOf([user, { type: 'turn_ended', status: 'error', error: 'Named models unavailable' }])).toEqual({
    _tag: 'Failed',
    reason: 'Named models unavailable',
  });
  expect(endOf([user, answer('DONE')])).toEqual({ _tag: 'Completed', message: 'DONE' });
  expect(endOf([user, { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'Shell' }] } }])).toEqual({ _tag: 'Open' });
  expect(endOf([user])).toEqual({ _tag: 'Open' });
});
