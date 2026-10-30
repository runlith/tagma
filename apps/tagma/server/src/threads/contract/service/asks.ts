import type { AgentAside, AgentAsideAnswer, AgentAsideCalledTool } from '@runlith/agent/AgentAside';
import type { LLMError } from '@runlith/llm/schema/errors';
import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type ThreadSelection = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type ThreadAskBasis = ThreadSelection & {
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

export type OverAnswer = { readonly answer: AgentAsideAnswer; readonly basis: ThreadAskBasis };

export class ThreadAsks extends Context.Service<
  ThreadAsks,
  {
    held(threadId: string): AgentAside | undefined;
    standing(copy: AgentAside, current: ThreadSelection): Effect.Effect<CopyStanding, NotWarm>;
    over(threadId: string, instruction: string, copy?: AgentAside): Effect.Effect<OverAnswer, NotWarm | LLMError | AgentAsideCalledTool>;
  }
>()('tagma/threads/ThreadAsks') {}
