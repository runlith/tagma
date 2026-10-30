import type { ActivityPlacement } from '@runlith/activity/Activity';
import type { DecisionAnswer, DecisionRequest } from '@runlith/llm/decision';
import { Context, type Effect } from 'effect';
import type { AskRefused } from '../../../providers/contract/service/asks.js';
import type { AskPath } from '../../../providers/contract/wire/asks.js';
import type { HarnessFailure } from './failure.js';

export type ThreadDecision = DecisionAnswer & { readonly path: AskPath };

export class ThreadDecisions extends Context.Service<
  ThreadDecisions,
  {
    decide(
      threadId: string,
      request: DecisionRequest,
      placement?: ActivityPlacement,
    ): Effect.Effect<ThreadDecision, AskRefused | HarnessFailure>;
  }
>()('tagma/threads/ThreadDecisions') {}
