import type { FinishReason } from '@runlith/llm/schema/ids';
import { type AgentContinuationState, AgentResponseUnfinished } from './AgentFailure';

export function unsuccessfulFinish(reason: FinishReason, continuation?: AgentContinuationState): AgentResponseUnfinished | null {
  if (reason === 'stop' || reason === 'tool-calls') return null;
  return new AgentResponseUnfinished({ finish: reason, continuation });
}
