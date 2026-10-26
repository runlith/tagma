import { Context, Effect, type Stream } from 'effect';
import { LLMEvent } from '@runlith/llm/schema/events';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { ModelRequest, ModelRequestInput, ModelRequester, ModelStreamInput } from './modelPort';

export class ModelCalls extends Context.Service<
  ModelCalls,
  {
    request(input: ModelRequestInput): Effect.Effect<ModelRequest>;
    open(request: ModelRequest, input: ModelStreamInput): Stream.Stream<LLMEvent, LLMError>;
  }
>()('@runlith/agent/ModelCalls') {
  static over(models: ModelRequester): Context.Context<ModelCalls> {
    return Context.make(
      ModelCalls,
      ModelCalls.of({
        request: (input) => Effect.sync(() => models.request(input)),
        open: (request, input) => request.stream(input),
      }),
    );
  }
}
