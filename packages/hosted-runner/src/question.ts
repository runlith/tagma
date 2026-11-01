import { Effect, Result, Schema } from 'effect';
import type { Outlet } from '@runlith/acp/agent';
import { RequestPermissionResult, type RequestPermissionParams } from '@runlith/acp/methods';
import type { ToolCall } from '@runlith/acp/toolCalls';

const ALLOW = 'allow';
const REJECT = 'reject';

const decodeAnswer = Schema.decodeUnknownResult(RequestPermissionResult);

const refusalOf = (answer: unknown): string | null => {
  const read = decodeAnswer(answer);
  if (Result.isFailure(read)) return 'The client answered the question about this call in a shape Tagma cannot read.';
  const { outcome } = read.success;
  if (outcome.outcome === 'cancelled') return 'The question about this call was cancelled before it was allowed.';
  return outcome.optionId === ALLOW ? null : 'Tagma declined this call.';
};

export const permitted = (outlet: Outlet, sessionId: string, toolCall: ToolCall): Effect.Effect<string | null> => {
  const params: RequestPermissionParams = {
    sessionId,
    toolCall,
    options: [
      { optionId: ALLOW, name: 'Allow', kind: 'allow_once' },
      { optionId: REJECT, name: 'Reject', kind: 'reject_once' },
    ],
  };
  return outlet.request('session/request_permission', params).pipe(
    Effect.map(refusalOf),
    Effect.catchTag('AgentFault', (fault) => Effect.succeed(`Tagma could not ask whether this call may go ahead: ${fault.message}`)),
  );
};
