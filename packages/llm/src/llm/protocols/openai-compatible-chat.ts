import { Effect, Schema } from 'effect';
import { Route, type RouteRoutedModelInput } from '../route/definition';
import { Endpoint } from '../route/endpoint';
import * as Framing from '../route/framing';
import * as Protocol from '../route/protocol';
import * as OpenAIChat from './openai-chat';
import * as OpenAIOptions from './utils/openai-options';

const ADAPTER = 'openai-compatible-chat';

export const options = OpenAIChat.options;

export type OpenAICompatibleChatModelInput = RouteRoutedModelInput;

const OpenAICompatibleChatBody = Schema.Struct({
  ...OpenAIChat.bodyFields,
  thinking: Schema.optional(Schema.Struct({ type: Schema.Literals(['enabled', 'disabled']) })),
});

export const protocol = Protocol.make({
  ...OpenAIChat.protocol,
  id: ADAPTER,
  body: {
    schema: OpenAICompatibleChatBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map((body) => {
          const thinking = OpenAIOptions.thinking(request);
          return thinking === undefined ? body : { ...body, thinking };
        }),
      ),
  },
});

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path('/chat/completions'),
  framing: Framing.sse,
});
