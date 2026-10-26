import { Schema } from 'effect';
import * as Auth from '../route/auth';
import { Route } from '../route/definition';
import { Endpoint } from '../route/endpoint';
import * as Framing from '../route/framing';
import * as Protocol from '../route/protocol';
import { type ProviderOptions } from '../schema/options';
import type { ProviderMetadata } from '../schema/ids';
import { type LLMRequest } from '../schema/messages';
import { JsonObject, optionalArray, optionalNull } from './shared';
import { fromRequest } from './anthropic/lower';
import { step, initialState } from './anthropic/stream';
import { rateLimits } from './anthropic/rateLimits';

export const ADAPTER = 'anthropic-messages';
export const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const PATH = '/messages';

const AnthropicCacheControl = Schema.Struct({
  type: Schema.tag('ephemeral'),
  ttl: Schema.optional(Schema.Literals(['5m', '1h'])),
});

export const AnthropicTextBlock = Schema.Struct({
  type: Schema.tag('text'),
  text: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicTextBlock = Schema.Schema.Type<typeof AnthropicTextBlock>;

export const AnthropicImageBlock = Schema.Struct({
  type: Schema.tag('image'),
  source: Schema.Struct({
    type: Schema.tag('base64'),
    media_type: Schema.String,
    data: Schema.String,
  }),
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicImageBlock = Schema.Schema.Type<typeof AnthropicImageBlock>;

const AnthropicThinkingBlock = Schema.Struct({
  type: Schema.tag('thinking'),
  thinking: Schema.String,
  signature: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
});

export const AnthropicToolUseBlock = Schema.Struct({
  type: Schema.tag('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  caller: Schema.optional(JsonObject),
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicToolUseBlock = Schema.Schema.Type<typeof AnthropicToolUseBlock>;

export const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.tag('server_tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicServerToolUseBlock = Schema.Schema.Type<typeof AnthropicServerToolUseBlock>;

export const AnthropicServerToolResultType = Schema.Literals([
  'web_search_tool_result',
  'code_execution_tool_result',
  'web_fetch_tool_result',
]);
export type AnthropicServerToolResultType = Schema.Schema.Type<typeof AnthropicServerToolResultType>;

export const AnthropicServerToolResultBlock = Schema.Struct({
  type: AnthropicServerToolResultType,
  tool_use_id: Schema.String,
  content: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicServerToolResultBlock = Schema.Schema.Type<typeof AnthropicServerToolResultBlock>;

const AnthropicFallbackModel = Schema.Struct({ model: Schema.String });
export const AnthropicFallbackBlock = Schema.Struct({
  type: Schema.tag('fallback'),
  from: AnthropicFallbackModel,
  to: AnthropicFallbackModel,
  trigger: Schema.optional(JsonObject),
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicFallbackBlock = Schema.Schema.Type<typeof AnthropicFallbackBlock>;

const AnthropicToolReference = Schema.Struct({
  type: Schema.tag('tool_reference'),
  tool_name: Schema.String,
});
const AnthropicToolResultContent = Schema.Union([AnthropicTextBlock, AnthropicImageBlock, AnthropicToolReference]);

export const AnthropicToolResultBlock = Schema.Struct({
  type: Schema.tag('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.Union([Schema.String, Schema.Array(AnthropicToolResultContent)]),
  is_error: Schema.optional(Schema.Boolean),
  cache_control: Schema.optional(AnthropicCacheControl),
});

export const AnthropicUserBlock = Schema.Union([AnthropicTextBlock, AnthropicImageBlock, AnthropicToolResultBlock]);
export type AnthropicUserBlock = Schema.Schema.Type<typeof AnthropicUserBlock>;
const AnthropicSystemOutputConfig = Schema.Struct({
  effort: Schema.optional(Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])),
});
export const AnthropicAssistantBlock = Schema.Union([
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolUseBlock,
  AnthropicServerToolUseBlock,
  AnthropicServerToolResultBlock,
  AnthropicFallbackBlock,
]);
export type AnthropicAssistantBlock = Schema.Schema.Type<typeof AnthropicAssistantBlock>;
export type AnthropicToolResultBlock = Schema.Schema.Type<typeof AnthropicToolResultBlock>;

export const AnthropicMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Union([Schema.String, Schema.Array(AnthropicUserBlock)]) }),
  Schema.Struct({ role: Schema.Literal('assistant'), content: Schema.Array(AnthropicAssistantBlock) }),
  Schema.Struct({
    role: Schema.Literal('system'),
    content: Schema.Union([Schema.String, Schema.Array(AnthropicTextBlock)]),
    output_config: Schema.optional(AnthropicSystemOutputConfig),
    clear_at: Schema.optional(Schema.Literal('next_user_message')),
  }),
]).pipe(Schema.toTaggedUnion('role'));
export type AnthropicMessage = Schema.Schema.Type<typeof AnthropicMessage>;

export const AnthropicTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  eager_input_streaming: Schema.optional(Schema.Boolean),
  defer_loading: Schema.optional(Schema.Literal(true)),
  cache_control: Schema.optional(AnthropicCacheControl),
});
export type AnthropicTool = Schema.Schema.Type<typeof AnthropicTool>;

const AnthropicToolChoice = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(['auto', 'any']),
    disable_parallel_tool_use: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.tag('tool'),
    name: Schema.String,
    disable_parallel_tool_use: Schema.optional(Schema.Boolean),
  }),
]);

const AnthropicThinking = Schema.Union([
  Schema.Struct({
    type: Schema.tag('enabled'),
    budget_tokens: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.tag('adaptive'),
    display: Schema.optional(Schema.Literals(['summarized', 'omitted'])),
  }),
  Schema.Struct({
    type: Schema.tag('disabled'),
  }),
]);

export const AnthropicThinkingDisplays = ['summarized', 'omitted'] as const;
export type AnthropicThinkingDisplay = (typeof AnthropicThinkingDisplays)[number];

export const AnthropicEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AnthropicEffort = (typeof AnthropicEfforts)[number];

const AnthropicOutputConfig = Schema.Struct({
  effort: Schema.optional(Schema.Literals(AnthropicEfforts)),
  format: Schema.optional(JsonObject),
});

const AnthropicContextManagement = Schema.Struct({
  edits: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      keep: Schema.optional(Schema.String),
    }),
  ),
});

const AnthropicDiagnostics = Schema.Struct({
  previous_message_id: Schema.NullOr(Schema.String),
});

const AnthropicThread = Schema.Union([
  Schema.Struct({
    type: Schema.tag('create'),
  }),
  Schema.Struct({
    type: Schema.tag('continue'),
    previous_message_id: Schema.String,
  }),
]);

const AnthropicFallbacks = Schema.Union([Schema.Literal('default'), Schema.Array(Schema.Struct({ model: Schema.String }))]);

const AnthropicMetadata = Schema.Struct({
  user_id: Schema.optional(Schema.String),
});

const AnthropicBodyFields = {
  model: Schema.String,
  system: optionalArray(AnthropicTextBlock),
  metadata: Schema.optional(AnthropicMetadata),
  messages: Schema.Array(AnthropicMessage),
  tools: optionalArray(AnthropicTool),
  tool_choice: Schema.optional(AnthropicToolChoice),
  stream: Schema.Boolean,
  max_tokens: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  top_k: Schema.optional(Schema.Number),
  stop_sequences: optionalArray(Schema.String),
  thinking: Schema.optional(AnthropicThinking),
  output_config: Schema.optional(AnthropicOutputConfig),
  context_management: Schema.optional(AnthropicContextManagement),
  thread: Schema.optional(AnthropicThread),
  diagnostics: Schema.optional(AnthropicDiagnostics),
  fallbacks: Schema.optional(AnthropicFallbacks),
};
const AnthropicMessagesBody = Schema.Struct(AnthropicBodyFields);
export type AnthropicMessagesBody = Schema.Schema.Type<typeof AnthropicMessagesBody>;

const AnthropicUsageIteration = Schema.Struct({
  type: Schema.optional(Schema.String),
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: optionalNull(Schema.Number),
  cache_read_input_tokens: optionalNull(Schema.Number),
});

export const AnthropicUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: optionalNull(Schema.Number),
  cache_read_input_tokens: optionalNull(Schema.Number),
  output_tokens_details: Schema.optional(Schema.Struct({ thinking_tokens: Schema.optional(Schema.Number) })),
  iterations: optionalArray(AnthropicUsageIteration),
});
export type AnthropicUsage = Schema.Schema.Type<typeof AnthropicUsage>;

const AnthropicStreamBlock = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
  caller: Schema.optional(JsonObject),
  from: Schema.optional(AnthropicFallbackModel),
  to: Schema.optional(AnthropicFallbackModel),
  trigger: Schema.optional(JsonObject),
  tool_use_id: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Unknown),
});

const AnthropicStreamDelta = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  partial_json: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  stop_reason: optionalNull(Schema.String),
  stop_sequence: optionalNull(Schema.String),
});

export const AnthropicEvent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    id: Schema.optional(Schema.String),
    content: Schema.optional(Schema.Array(AnthropicStreamBlock)),
    stop_reason: optionalNull(Schema.String),
    index: Schema.optional(Schema.Number),
    message: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String), usage: Schema.optional(AnthropicUsage) })),
    content_block: Schema.optional(AnthropicStreamBlock),
    delta: Schema.optional(AnthropicStreamDelta),
    usage: Schema.optional(AnthropicUsage),
    error: optionalNull(
      Schema.StructWithRest(Schema.Struct({ type: optionalNull(Schema.String), message: optionalNull(Schema.String) }), [
        Schema.Record(Schema.String, Schema.Unknown),
      ]),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type AnthropicEvent = Schema.Schema.Type<typeof AnthropicEvent>;

export const anthropicMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ anthropic: metadata });

export const options = (input: {
  readonly stream?: boolean;
  readonly thinking?:
    | { readonly type: 'enabled'; readonly budgetTokens: number }
    | { readonly type: 'adaptive'; readonly display?: AnthropicThinkingDisplay }
    | { readonly type: 'disabled' }
    | undefined;
  readonly disableParallelToolUse?: boolean | undefined;
  readonly userId?: string | undefined;
  readonly outputConfig?: { readonly effort?: AnthropicEffort; readonly format?: Record<string, unknown> } | undefined;
  readonly contextManagement?: { readonly edits: readonly { readonly type: string; readonly keep?: string }[] } | undefined;
  readonly thread?: { readonly type: 'create' } | { readonly type: 'continue'; readonly previous_message_id: string } | undefined;
  readonly diagnostics?: { readonly previous_message_id: string | null } | undefined;
  readonly preserveEmptyTools?: boolean | undefined;
  readonly fallbacks?: 'default' | ReadonlyArray<{ readonly model: string }> | undefined;
}): ProviderOptions | undefined => {
  const anthropic = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return Object.keys(anthropic).length === 0 ? undefined : { anthropic };
};

export const headers = ({ request }: { readonly request: LLMRequest }) => ({
  'anthropic-version': '2023-06-01',
  ...(request.tools.some((tool) => tool.deferred) ? { 'anthropic-beta': 'advanced-tool-use-2025-11-20' } : {}),
});

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: AnthropicMessagesBody,
    from: fromRequest,
    cachePrefix: (body) => ({ system: body.system, tools: body.tools?.filter((tool) => tool.defer_loading !== true) }),
  },
  stream: {
    event: Protocol.jsonEvent(AnthropicEvent),
    initial: initialState,
    step,
  },
  rateLimits,
  inlineCacheHints: true,
});

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  framing: Framing.sse,
  headers: headers,
});
