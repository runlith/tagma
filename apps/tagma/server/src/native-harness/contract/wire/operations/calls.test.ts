import { expect, test } from 'bun:test';
import { CALL_OPERATIONS } from './calls.js';

test('a wait on a call declares the call it watches and its budget in milliseconds', () => {
  const display = CALL_OPERATIONS.wait_call.called({ runId: 'run-1', toolCallId: 'call-9', waitMs: 45_000 });
  expect(display).toMatchObject({ awaitsMs: 45_000, reference: { kind: 'call', runId: 'run-1', toolCallId: 'call-9' } });
});

test('a call wait whose arguments are still streaming declares nothing to watch', () => {
  expect(Reflect.apply(CALL_OPERATIONS.wait_call.called, undefined, [{ runId: 'run-1' }]).reference).toBeUndefined();
});
