import { expect, test } from 'bun:test';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { HOSTED_RESULT } from '@runlith/agent/thread/run/hostedReplay';
import { hostedHistory } from './hostedHistory';

test('hosted history restores the recorded verdict of a JSON tool result', () => {
  const result = (id: string, failed: boolean) =>
    Message.tool(
      ToolResultPart.from({
        id,
        name: 'ask_user',
        result: { type: 'json', value: { status: 'refused', code: 'body-shape' } },
        metadata: { [HOSTED_RESULT]: { failed, offered: false } },
      }),
    );
  expect(hostedHistory([result('refused', true), result('answered', false)])).toMatchObject([
    { role: 'result', id: 'refused', failed: true },
    { role: 'result', id: 'answered', failed: false },
  ]);
});
