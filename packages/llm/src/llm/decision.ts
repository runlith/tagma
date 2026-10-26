import { Data } from 'effect';
import type { LLMError } from './schema/errors';
import type { Usage } from './schema/events';
import type { ModelIdentity } from './schema/options';

export type DecisionContent = string | { readonly [field: string]: unknown } | readonly unknown[];

export type NoulQuestion = {
  readonly type: 'noul';
  readonly instructions?: DecisionContent;
  readonly criteria?: { readonly true: DecisionContent; readonly false: DecisionContent };
};

export type ChoiceQuestion = {
  readonly type: 'choice';
  readonly instructions?: DecisionContent;
  readonly criteria: { readonly [option: string]: DecisionContent | null };
};

export type ScoreQuestion = {
  readonly type: 'score';
  readonly instructions?: DecisionContent;
  readonly criteria: readonly [DecisionContent, ...DecisionContent[]];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type DecisionRequest = {
  readonly state: DecisionContent;
  readonly questions: { readonly [name: string]: DecisionQuestion };
  readonly instructions?: string;
};

export type NoulVerdict = { readonly type: 'noul'; readonly noul: boolean; readonly probability: number | null };

export type ChoiceVerdict = {
  readonly type: 'choice';
  readonly choice: string;
  readonly probabilities: { readonly [option: string]: number } | null;
  readonly confidence: number | null;
};

export type ScoreVerdict = {
  readonly type: 'score';
  readonly score: number;
  readonly probabilities: { readonly [level: string]: number } | null;
  readonly confidence: number | null;
};

export type DecisionVerdict = NoulVerdict | ChoiceVerdict | ScoreVerdict;

export type DecisionAnswer = {
  readonly model: ModelIdentity;
  readonly answers: { readonly [name: string]: DecisionVerdict };
  readonly usage: Usage | undefined;
};

export const DECISION_REFUSALS = ['no-model', 'malformed', 'provider-refused', 'input-too-large'] as const;
export type DecisionRefusal = (typeof DECISION_REFUSALS)[number];

export class DecisionRefused extends Data.TaggedError('DecisionRefused')<{
  readonly reason: DecisionRefusal;
  readonly message: string;
  readonly failure?: LLMError;
}> {}

export const providerRefusal = (failure: LLMError): DecisionRefused =>
  new DecisionRefused({
    reason:
      failure.reason._tag === 'InvalidProviderOutput'
        ? 'malformed'
        : failure.reason._tag === 'InvalidRequest' && failure.reason.classification === 'context-overflow'
          ? 'input-too-large'
          : 'provider-refused',
    message: failure.message,
    failure,
  });
