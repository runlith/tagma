import { expect, test } from 'bun:test';
import { Message } from '@runlith/llm/schema/messages';
import { withAgentOrigin, withAgentReaderInput } from '@runlith/agent/AgentSignal';
import { titleContext } from './context.js';

test('naming projects reader words and reader steers, excluding runtime and tool traffic', () => {
  const history = [
    withAgentReaderInput(Message.user('Build a parser'), 'first'),
    withAgentOrigin(Message.user('orientation '.repeat(10000)), 'orientation'),
    Message.assistant('investigation '.repeat(10000)),
    withAgentOrigin(Message.user('a worker report'), 'envelope'),
    withAgentReaderInput(withAgentOrigin(Message.user('Preserve Unicode'), 'envelope'), 'steer'),
    withAgentOrigin(Message.user('guidance'), 'guidance'),
    Message.user('Keep the errors typed'),
  ];
  const before = JSON.stringify(history);
  expect(titleContext(history, 8192)).toBe('Build a parser\nPreserve Unicode\nKeep the errors typed');
  expect(JSON.stringify(history)).toBe(before);
});

test('a long discussion retains its opening and latest words within the excerpt budget', () => {
  const history = [Message.user('OPEN ' + 'middle '.repeat(1000)), Message.user('CLOSE')];
  expect(titleContext(history, 13)).toBe('OPEN \n…\nCLOSE');
  for (const budget of [1, 2, 3, 13, 100]) {
    expect(titleContext(history, budget).length).toBeLessThanOrEqual(budget);
  }
  expect(titleContext([Message.user('tiny')], 13)).toBe('tiny');
  expect(titleContext([], 13)).toBe('');
});
