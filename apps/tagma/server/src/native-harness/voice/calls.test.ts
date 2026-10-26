import { expect, test } from 'bun:test';
import type { CallRecord } from '@runlith/agent/callProgress';
import { callLine, callsText } from './calls.js';

const record: CallRecord = {
  runId: 'run-1',
  toolCallId: 'call-9',
  threadId: 'thread-1',
  name: 'read_block',
  input: { blockId: 'abcd1234' },
  phase: 'running',
  mode: 'foreground',
  detachable: true,
  startedAt: Date.now() - 12_000,
  admittedAt: null,
  endedAt: null,
  expiresAt: null,
  expiresBy: null,
  limitCeilingMs: null,
  detail: 'waiting on approval',
  executions: [],
};

test('a call line carries the pair control_call addresses, exactly as it spells them', () => {
  const line = callLine(record);
  expect(line).toContain('run-1');
  expect(line).toContain('call-9');
  expect(line).toContain('read_block');
});

test('the continuing call works as printed', () => {
  const text = callsText({ status: 'ok', calls: [record], total: 2, next: 'cursor-word' });
  expect(text).toContain('read_calls(cursor="cursor-word")');
});
