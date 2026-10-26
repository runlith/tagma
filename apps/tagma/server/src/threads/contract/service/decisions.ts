import type { ActivityPlacement } from '@runlith/activity/Activity';
import type { DecisionAnswer, DecisionRefused, DecisionRequest } from '@runlith/llm/decision';
import { Context, type Effect } from 'effect';
import type { HarnessFailure } from './failure.js';

export type ThreadDecision = DecisionAnswer & { readonly road: string };

export class ThreadDecisions extends Context.Service<
  ThreadDecisions,
  {
    decide(
      threadId: string,
      request: DecisionRequest,
      placement?: ActivityPlacement,
    ): Effect.Effect<ThreadDecision, DecisionRefused | HarnessFailure>;
  }
>()('tagma/threads/ThreadDecisions') {}
