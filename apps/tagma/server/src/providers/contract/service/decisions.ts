import type { DecisionAnswer, DecisionRefused, DecisionRequest } from '@runlith/llm/decision';
import { Context, type Effect } from 'effect';

export type DecisionCall = {
  readonly provider: string;
  readonly model: string;
  readonly account: string | null;
  readonly ownerId: string;
};

export class DecisionModels extends Context.Service<
  DecisionModels,
  {
    decide(call: DecisionCall, request: DecisionRequest): Effect.Effect<DecisionAnswer, DecisionRefused>;
  }
>()('tagma/providers/DecisionModels') {}
