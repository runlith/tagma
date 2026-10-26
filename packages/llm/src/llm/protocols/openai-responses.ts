import { Effect, Schema } from 'effect';
import * as Auth from '../route/auth';
import { Route } from '../route/definition';
import { Endpoint } from '../route/endpoint';
import * as Protocol from '../route/protocol';
import * as HttpTransport from '../route/transport/http';
import { jsonTransport } from '../route/transport/websocket';
import * as ProviderShared from './shared';
import { JsonObject, optionalArray, optionalNull } from './shared';
import { isRecord } from '../utils/record';
import * as OpenAIOptions from './utils/openai-options';
import { fromRequest } from './openai/lower';
import { TERMINAL_TYPES, step, initialState } from './openai/stream';
import { rateLimits } from './openai/rateLimits';

export const ADAPTER = 'openai-responses';
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const PATH = '/responses';

export const options = OpenAIOptions.make;
export const serviceTier = OpenAIOptions.serviceTier;

const OpenAIResponsesInputText = Schema.Struct({
  type: Schema.tag('input_text'),
  text: Schema.String,
});
const OpenAIResponsesInputImage = Schema.Struct({
  type: Schema.tag('input_image'),
  image_url: Schema.String,
});
const OpenAIResponsesInputContent = Schema.Union([OpenAIResponsesInputText, OpenAIResponsesInputImage]);
type OpenAIResponsesInputContent = Schema.Schema.Type<typeof OpenAIResponsesInputContent>;

const OpenAIResponsesOutputText = Schema.Struct({
  type: Schema.tag('output_text'),
  text: Schema.String,
});

const OpenAIResponsesReasoningSummaryText = Schema.Struct({
  type: Schema.tag('summary_text'),
  text: Schema.String,
});

const OpenAIResponsesReasoningItem = Schema.Struct({
  type: Schema.tag('reasoning'),
  id: Schema.optional(Schema.String),
  summary: Schema.Array(OpenAIResponsesReasoningSummaryText),
  encrypted_content: optionalNull(Schema.String),
});

const OpenAIResponsesItemReference = Schema.Struct({
  type: Schema.tag('item_reference'),
  id: Schema.String,
});

const OpenAIResponsesFunctionCallOutputContent = Schema.Union([OpenAIResponsesInputText, OpenAIResponsesInputImage]);

const OpenAIResponsesFunctionCallOutput = Schema.Union([Schema.String, Schema.Array(OpenAIResponsesFunctionCallOutputContent)]);

export const OpenAIResponsesInputItem = Schema.Union([
  Schema.Struct({ role: Schema.tag('system'), content: Schema.String }),
  Schema.Struct({ role: Schema.tag('user'), content: Schema.Array(OpenAIResponsesInputContent) }),
  Schema.Struct({ role: Schema.tag('assistant'), content: Schema.Array(OpenAIResponsesOutputText) }),
  OpenAIResponsesReasoningItem,
  OpenAIResponsesItemReference,
  Schema.Struct({
    type: Schema.tag('function_call'),
    call_id: Schema.String,
    name: Schema.String,
    namespace: Schema.optional(Schema.String),
    arguments: Schema.String,
  }),
  Schema.Struct({
    type: Schema.tag('function_call_output'),
    call_id: Schema.String,
    output: OpenAIResponsesFunctionCallOutput,
  }),
]);
export type OpenAIResponsesInputItem = Schema.Schema.Type<typeof OpenAIResponsesInputItem>;

export type OpenAIResponsesReasoningInput = {
  type: 'reasoning';
  id: string;
  summary: Array<{ type: 'summary_text'; text: string }>;
  encrypted_content?: string | null;
};
export type OpenAIResponsesReasoningReplay = Omit<OpenAIResponsesReasoningInput, 'id'>;

const OpenAIResponsesFunctionTool = Schema.Struct({
  type: Schema.tag('function'),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
});
export type OpenAIResponsesFunctionTool = Schema.Schema.Type<typeof OpenAIResponsesFunctionTool>;

export const OpenAIResponsesTool = Schema.Union([
  OpenAIResponsesFunctionTool,
  Schema.Struct({
    type: Schema.tag('namespace'),
    name: Schema.String,
    description: Schema.String,
    tools: Schema.Array(OpenAIResponsesFunctionTool),
  }),
]);
export type OpenAIResponsesTool = Schema.Schema.Type<typeof OpenAIResponsesTool>;

const OpenAIResponsesToolChoice = Schema.Union([
  Schema.Literals(['auto', 'none', 'required']),
  Schema.Struct({ type: Schema.tag('function'), name: Schema.String }),
]);

const OpenAIResponsesCoreFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  instructions: Schema.optional(Schema.String),
  tools: optionalArray(OpenAIResponsesTool),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  parallel_tool_calls: Schema.optional(Schema.Boolean),
  store: Schema.optional(Schema.Boolean),
  service_tier: Schema.optional(OpenAIOptions.OpenAIServiceTier),
  prompt_cache_key: Schema.optional(Schema.String),
  include: optionalArray(OpenAIOptions.OpenAIResponseIncludable),
  reasoning: Schema.optional(
    Schema.Struct({
      effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
      summary: Schema.optional(Schema.Literal('auto')),
    }),
  ),
  text: Schema.optional(
    Schema.Struct({
      verbosity: Schema.optional(OpenAIOptions.OpenAITextVerbosity),
    }),
  ),
  max_output_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
};

const OpenAIResponsesBody = Schema.Struct({
  ...OpenAIResponsesCoreFields,
  stream: Schema.Literal(true),
});
export type OpenAIResponsesBody = Schema.Schema.Type<typeof OpenAIResponsesBody>;

const OpenAIResponsesWebSocketMessage = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag('response.create'),
    ...OpenAIResponsesCoreFields,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
type OpenAIResponsesWebSocketMessage = Schema.Schema.Type<typeof OpenAIResponsesWebSocketMessage>;
const encodeWebSocketMessage = Schema.encodeSync(Schema.fromJsonString(OpenAIResponsesWebSocketMessage));

export const OpenAIResponsesUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  input_tokens_details: optionalNull(Schema.Struct({ cached_tokens: Schema.optional(Schema.Number) })),
  output_tokens: Schema.optional(Schema.Number),
  output_tokens_details: optionalNull(Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) })),
  total_tokens: Schema.optional(Schema.Number),
});
export type OpenAIResponsesUsage = Schema.Schema.Type<typeof OpenAIResponsesUsage>;

export const OpenAIResponsesStreamItem = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  call_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Unknown),
  queries: Schema.optional(Schema.Unknown),
  results: Schema.optional(Schema.Unknown),
  code: Schema.optional(Schema.String),
  container_id: Schema.optional(Schema.String),
  outputs: Schema.optional(Schema.Unknown),
  server_label: Schema.optional(Schema.String),
  output: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  encrypted_content: optionalNull(Schema.String),
});
export type OpenAIResponsesStreamItem = Schema.Schema.Type<typeof OpenAIResponsesStreamItem>;

const OpenAIResponsesErrorPayload = Schema.StructWithRest(
  Schema.Struct({
    code: optionalNull(Schema.String),
    type: optionalNull(Schema.String),
    message: optionalNull(Schema.String),
    param: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const OpenAIResponsesEvent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    sequence_number: Schema.optional(Schema.Number),
    delta: Schema.optional(Schema.String),
    item_id: Schema.optional(Schema.String),
    summary_index: Schema.optional(Schema.Number),
    item: Schema.optional(OpenAIResponsesStreamItem),
    response: Schema.optional(
      Schema.StructWithRest(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          service_tier: optionalNull(Schema.String),
          incomplete_details: optionalNull(Schema.Struct({ reason: Schema.String })),
          usage: optionalNull(OpenAIResponsesUsage),
          error: optionalNull(OpenAIResponsesErrorPayload),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    error: optionalNull(OpenAIResponsesErrorPayload),
    code: optionalNull(Schema.String),
    message: optionalNull(Schema.String),
    param: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type OpenAIResponsesEvent = Schema.Schema.Type<typeof OpenAIResponsesEvent>;

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIResponsesBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(OpenAIResponsesEvent),
    initial: initialState,
    step,
    terminal: (event) => TERMINAL_TYPES.has(event.type),
  },
  rateLimits,
});

const endpoint = Endpoint.path<OpenAIResponsesBody>(PATH, { baseURL: DEFAULT_BASE_URL });
const auth = Auth.none;

export const httpTransport = HttpTransport.sseJson.with<OpenAIResponsesBody>();

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint,
  auth,
  transport: httpTransport,
  defaults: { providerOptions: { openai: { store: false } } },
});

const decodeWebSocketMessage = ProviderShared.validateWith(Schema.decodeUnknownEffect(OpenAIResponsesWebSocketMessage));

const webSocketMessage = Effect.fnUntraced(function* (body: OpenAIResponsesBody | Record<string, unknown>) {
  if (!isRecord(body)) return yield* ProviderShared.invalidRequest('OpenAI Responses WebSocket body must be a JSON object');
  const { stream: _stream, ...message } = body;
  return yield* decodeWebSocketMessage({ ...message, type: 'response.create' });
});

export const webSocketTransport = jsonTransport.with<OpenAIResponsesBody, OpenAIResponsesWebSocketMessage>({
  toMessage: webSocketMessage,
  encodeMessage: encodeWebSocketMessage,
});

export const webSocketRoute = Route.make({
  id: `${ADAPTER}-websocket`,
  protocol,
  endpoint,
  auth,
  transport: webSocketTransport,
  defaults: { providerOptions: { openai: { store: false } } },
});
