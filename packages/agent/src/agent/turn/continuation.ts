import type { ModelContinuationPolicy } from '@runlith/llm/profiles/contract';
import { Message } from '@runlith/llm/schema/messages';
import { withAgentOrigin } from '../AgentSignal';

export const STEP_CONTINUATION: ModelContinuationPolicy = {
  limit: 3,
  prompt:
    'Your response reached the output limit and was cut off. Continue directly from where it stopped, without repeating or recapping what came before, and split the remaining work into smaller pieces.',
};

const MARK = 'continuation';

export const continuationMessage = (policy: ModelContinuationPolicy): Message =>
  withAgentOrigin(new Message({ ...Message.user(policy.prompt), metadata: { [MARK]: true } }), 'guidance');

export const continuedBefore = (messages: readonly Message[]): number => {
  let continued = 0;
  for (let at = messages.length - 1; at >= 1; at -= 2) {
    if (messages[at]?.metadata?.[MARK] !== true || messages[at - 1]?.role !== 'assistant') break;
    continued += 1;
  }
  return continued;
};
