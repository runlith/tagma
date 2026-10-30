import type { AgentAside, AgentAsideAnswer, AgentAsideCalledTool } from '@runlith/agent/AgentAside';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { AskRefused, ModelSelection } from '../../../providers/contract/service/asks.js';
import { Context, type Effect } from 'effect';
import { GateRefusal, type Unblock } from '../../../platform/contract/wire/refusal.js';

export type ThreadAskBasis = ModelSelection & {
  readonly source: AgentAside['source'];
  readonly runId: string;
  readonly stepNumber: number;
  readonly readerInput: string | null;
  readonly readerPosition: number | null;
  readonly expiresAt: number | null;
};

export type CopyStanding =
  | { readonly _tag: 'Standing'; readonly basis: ThreadAskBasis }
  | { readonly _tag: 'Moved'; readonly reason: 'model-changed' | 'rung-changed' | 'account-changed' };

export type NotWarm = GateRefusal<'not-warm'>;

export const notWarm = (
  reason: string,
  unblock: Unblock = ['send a message in this thread, then ask again while its prompt cache is warm'],
): NotWarm => new GateRefusal('not-warm', reason, unblock);

export class ThreadAsks extends Context.Service<
  ThreadAsks,
  {
    held(threadId: string): AgentAside | undefined;
    standing(copy: AgentAside, current: ModelSelection): Effect.Effect<CopyStanding, LLMError>;
    over(
      threadId: string,
      instruction: string,
      copy?: AgentAside,
    ): Effect.Effect<AgentAsideAnswer, NotWarm | AskRefused | AgentAsideCalledTool>;
  }
>()('tagma/threads/ThreadAsks') {}
