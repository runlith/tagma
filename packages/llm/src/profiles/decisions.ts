import type { Effect } from 'effect';
import type { DecisionAnswer, DecisionRefused, DecisionRequest } from '../llm/decision';
import type { HttpExecutor } from '../llm/route/executor';
import type { ProfileSelection } from './contract';

export type DecisionProfile = {
  decide(selection: ProfileSelection, request: DecisionRequest): Effect.Effect<DecisionAnswer, DecisionRefused, HttpExecutor>;
};
