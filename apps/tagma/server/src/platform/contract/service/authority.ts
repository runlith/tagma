import { Context } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';

export const CallAuthority = Context.Reference<AgentApprovalMode | null>('tagma/platform/CallAuthority', {
  defaultValue: () => null,
});
