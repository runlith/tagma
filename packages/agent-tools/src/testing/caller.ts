import type { ThreadBindings, ToolCaller } from '@runlith/agent/contracts';

export const unthreadedCaller: ToolCaller = { agentId: 'agent', ownerId: 'owner', thread: null };

export const callerInThread = (threadId: string, runId: string, bindings: ThreadBindings = {}): ToolCaller => ({
  agentId: 'agent',
  ownerId: 'owner',
  thread: { threadId, runId, bindings },
});
