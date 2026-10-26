import { Effect } from 'effect';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { PromptBlock } from './translate.js';

export const CANCELLED = -32800;

export type Heard = Extract<SDKMessage, { readonly type: 'user' }>;

export type Ended = Extract<SDKMessage, { readonly type: 'result' }>;

export const failed = (message: string) => new AgentFault({ code: FAULT.internal, message });

export const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const sdkCall = <A>(what: string, call: () => Promise<A>): Effect.Effect<A, AgentFault> =>
  Effect.tryPromise({ try: call, catch: (cause) => failed(`Claude Code refused ${what}: ${said(cause)}`) });

export const user = (content: string | readonly PromptBlock[], extra: Partial<SDKUserMessage>): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: content as SDKUserMessage['message']['content'] },
  parent_tool_use_id: null,
  ...extra,
});
