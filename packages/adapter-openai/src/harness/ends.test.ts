import { expect, test } from 'bun:test';
import { codexTerminal } from './codex.js';

const judge = codexTerminal.metadata!.ends!.reader.judge;
const event = (payload: unknown) => ({ type: 'event_msg', payload });

test('task_complete carries the answer, turn_aborted aborts, and a started task is open', () => {
  const started = event({ type: 'task_started', turn_id: 't' });
  expect(
    judge([event({ type: 'task_complete', last_agent_message: 'BANANA DONE' }), event({ type: 'token_count' }), started], true, null),
  ).toEqual({
    _tag: 'Completed',
    message: 'BANANA DONE',
  });
  expect(judge([event({ type: 'token_count' }), event({ type: 'turn_aborted', reason: 'interrupted' }), started], true, null)).toEqual({
    _tag: 'Aborted',
  });
  expect(judge([started, event({ type: 'task_complete', last_agent_message: 'older' })], true, null)).toEqual({ _tag: 'Open' });
});
