import { expect, test } from 'bun:test';
import { ToolResultValue } from '@runlith/llm/schema/messages';
import { toolFailed, toolResultOutcome } from '../../transcript/entries';
import { settledToolEntry } from './ThreadToolRecords';

const call = {
  id: 'tool:run:call',
  runId: 'run',
  toolName: 'bash',
  toolCallId: 'call',
  input: { command: 'echo hi' },
  occurredAt: '2026-10-05T00:00:00.000Z',
};

test('a tool result settles the feed entry with its value as output, or with its text as the error when the result is an error', () => {
  const display = { form: 'command', title: 'Say hi', command: 'echo hi', output: 'hi\n', mutates: true } as const;
  expect(settledToolEntry(call, toolResultOutcome(ToolResultValue.from('hi\n')), display)).toEqual({
    type: 'tool',
    id: 'tool:run:call',
    runId: 'run',
    toolName: 'bash',
    toolCallId: 'call',
    toolState: 'output-available',
    toolInput: { command: 'echo hi' },
    toolOutput: 'hi\n',
    toolDisplay: display,
    occurredAt: call.occurredAt,
  });
  expect(settledToolEntry(call, toolResultOutcome(ToolResultValue.from('exit 2', 'error')), undefined)).toMatchObject({
    toolState: 'output-error',
    toolError: 'exit 2',
  });
  expect(settledToolEntry(call, { kind: 'denied' }, undefined)).not.toHaveProperty('toolOutput');
});

test('a domain refusal settles as refused with its code, and an answer whose data says refused stays an answer', () => {
  const refused = settledToolEntry(
    call,
    {
      kind: 'refused',
      refusal: { code: 'stale-source', reason: 'The anchor moved.' },
      output: { status: 'refused', code: 'stale-source' },
    },
    undefined,
  );
  expect(refused).toMatchObject({ toolState: 'output-refused', toolRefusal: { code: 'stale-source', reason: 'The anchor moved.' } });
  expect(toolFailed(refused.toolState)).toBe(true);

  const answered = settledToolEntry(call, { kind: 'answered', output: { status: 'refused', code: 'not-a-verdict' } }, undefined);
  expect(answered).toMatchObject({ toolState: 'output-available', toolOutput: { status: 'refused', code: 'not-a-verdict' } });
  expect(answered).not.toHaveProperty('toolRefusal');
  expect(toolFailed(answered.toolState)).toBe(false);
});

test('an execution failure, a cancel, a denial and an unknown effect each keep their own state', () => {
  const states = (['failed', 'cancelled', 'denied', 'unknown'] as const).map(
    (kind) => settledToolEntry(call, kind === 'failed' ? { kind, error: 'boom' } : { kind }, undefined).toolState,
  );
  expect(states).toEqual(['output-error', 'output-cancelled', 'output-denied', 'output-unknown']);
  expect(states.map(toolFailed)).toEqual([true, false, false, true]);
});
