import { expect, test } from 'bun:test';
import { AgentToolFailed } from '../../agent/AgentFailure';
import { ToolFailed } from '../../agent/tool';
import { callFailed } from './hostedRecords';

test('a hosted call that fails with a declared refusal settles as that refusal, and one without a code as a failure', () => {
  const failed = (code: string | undefined) =>
    new AgentToolFailed({ toolName: 'grep', toolCallId: 'call-1', cause: new ToolFailed({ reason: 'nowhere is absent', code }) });
  for (const confirmed of [false, true]) {
    expect(callFailed(failed('not-found'), confirmed, undefined, false).settlement).toEqual({
      kind: 'refused',
      refusal: { code: 'not-found', reason: 'nowhere is absent' },
    });
    expect(callFailed(failed(undefined), confirmed, undefined, false).settlement.kind).toBe('failed');
  }
});
