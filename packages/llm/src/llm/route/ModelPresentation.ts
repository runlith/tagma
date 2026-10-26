import type { Effect } from 'effect';
import type { LLMError } from '../schema/errors';
import type { LLMEvent } from '../schema/events';
import type { LLMRequest } from '../schema/messages';
import type { HttpExecutor } from './executor';

export interface ModelPresentationRuntime {
  readonly executor?: HttpExecutor['Service'];
}

export interface PresentedModelCall<Body = unknown> {
  readonly request: LLMRequest;
  readonly body?: (body: Body) => Body;
  readonly encode?: (body: Body) => string;
  readonly receive: (event: LLMEvent) => Effect.Effect<LLMEvent | readonly LLMEvent[], LLMError>;
  readonly failed?: (failure: LLMError) => Effect.Effect<void>;
}

export interface ModelPresentation<Body = unknown> {
  readonly resolve?: (request: LLMRequest) => Effect.Effect<
    {
      readonly request: LLMRequest;
      readonly present: ModelPresentation<Body>['present'];
    },
    LLMError
  >;
  readonly present: (request: LLMRequest, runtime: ModelPresentationRuntime) => Effect.Effect<PresentedModelCall<Body>, LLMError>;
}
