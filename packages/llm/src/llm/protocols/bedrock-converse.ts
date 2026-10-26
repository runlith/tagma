import { Effect, Schema } from 'effect';
import { Route } from '../route/definition';
import { Endpoint } from '../route/endpoint';
import * as Protocol from '../route/protocol';
import type { CacheHint, ToolSchemaDialect } from '../schema/options';
import type { JsonSchema, ProviderMetadata } from '../schema/ids';
import type { LLMRequest, ReasoningPart, ToolCallPart, ToolDefinition, ToolResultPart } from '../schema/messages';
import * as BedrockEventStream from './bedrock-event-stream';
import * as ProviderShared from './shared';
import { JsonObject, optionalArray } from './shared';
import { isRecord } from '../utils/record';
import * as BedrockAuth from './utils/bedrock-auth';
import * as BedrockCache from './utils/bedrock-cache';
import type { Breakpoints } from './utils/cache';
import * as BedrockMedia from './utils/bedrock-media';
import { ToolSchemaProjection } from './utils/tool-schema';
import { step, onHalt, initialState } from './bedrock/stream';

export const ADAPTER = 'bedrock-converse';

const BedrockTextBlock = Schema.Struct({
  text: Schema.String,
});
type BedrockTextBlock = Schema.Schema.Type<typeof BedrockTextBlock>;

const BedrockToolUseBlock = Schema.Struct({
  toolUse: Schema.Struct({
    toolUseId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
});
type BedrockToolUseBlock = Schema.Schema.Type<typeof BedrockToolUseBlock>;

const BedrockToolResultContentItem = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ json: Schema.Unknown }),
  BedrockMedia.ImageBlock,
]);

const BedrockToolResultBlock = Schema.Struct({
  toolResult: Schema.Struct({
    toolUseId: Schema.String,
    content: Schema.Array(BedrockToolResultContentItem),
    status: Schema.optional(Schema.Literals(['success', 'error'])),
  }),
});
type BedrockToolResultBlock = Schema.Schema.Type<typeof BedrockToolResultBlock>;

const BedrockReasoningBlock = Schema.Struct({
  reasoningContent: Schema.Struct({
    reasoningText: Schema.optional(
      Schema.Struct({
        text: Schema.String,
        signature: Schema.String,
      }),
    ),
  }),
});

const BedrockUserBlock = Schema.Union([
  BedrockTextBlock,
  BedrockMedia.ImageBlock,
  BedrockMedia.DocumentBlock,
  BedrockToolResultBlock,
  BedrockCache.CachePointBlock,
]);
type BedrockUserBlock = Schema.Schema.Type<typeof BedrockUserBlock>;

const BedrockAssistantBlock = Schema.Union([BedrockTextBlock, BedrockReasoningBlock, BedrockToolUseBlock, BedrockCache.CachePointBlock]);
type BedrockAssistantBlock = Schema.Schema.Type<typeof BedrockAssistantBlock>;

const BedrockMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(BedrockUserBlock) }),
  Schema.Struct({ role: Schema.Literal('assistant'), content: Schema.Array(BedrockAssistantBlock) }),
]).pipe(Schema.toTaggedUnion('role'));
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>;

const BedrockSystemBlock = Schema.Union([BedrockTextBlock, BedrockCache.CachePointBlock]);
type BedrockSystemBlock = Schema.Schema.Type<typeof BedrockSystemBlock>;

const BedrockToolSpec = Schema.Struct({
  toolSpec: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.Struct({
      json: JsonObject,
    }),
  }),
});
type BedrockToolSpec = Schema.Schema.Type<typeof BedrockToolSpec>;

const BedrockTool = Schema.Union([BedrockToolSpec, BedrockCache.CachePointBlock]);
type BedrockTool = Schema.Schema.Type<typeof BedrockTool>;

const BedrockToolChoice = Schema.Union([
  Schema.Struct({ auto: Schema.Struct({}) }),
  Schema.Struct({ any: Schema.Struct({}) }),
  Schema.Struct({ tool: Schema.Struct({ name: Schema.String }) }),
]);

const BedrockBodyFields = {
  modelId: Schema.String,
  messages: Schema.Array(BedrockMessage),
  system: optionalArray(BedrockSystemBlock),
  inferenceConfig: Schema.optional(
    Schema.Struct({
      maxTokens: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
      topP: Schema.optional(Schema.Number),
      stopSequences: optionalArray(Schema.String),
    }),
  ),
  toolConfig: Schema.optional(
    Schema.Struct({
      tools: Schema.Array(BedrockTool),
      toolChoice: Schema.optional(BedrockToolChoice),
    }),
  ),
  additionalModelRequestFields: Schema.optional(JsonObject),
};
const BedrockConverseBody = Schema.Struct(BedrockBodyFields);
export type BedrockConverseBody = Schema.Schema.Type<typeof BedrockConverseBody>;

export const BedrockUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
});
export type BedrockUsageSchema = Schema.Schema.Type<typeof BedrockUsageSchema>;

export const BedrockEvent = Schema.Struct({
  messageStart: Schema.optional(Schema.Struct({ role: Schema.String })),
  contentBlockStart: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      start: Schema.optional(
        Schema.Struct({
          toolUse: Schema.optional(Schema.Struct({ toolUseId: Schema.String, name: Schema.String })),
        }),
      ),
    }),
  ),
  contentBlockDelta: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      delta: Schema.optional(
        Schema.Struct({
          text: Schema.optional(Schema.String),
          toolUse: Schema.optional(Schema.Struct({ input: Schema.String })),
          reasoningContent: Schema.optional(
            Schema.Struct({
              text: Schema.optional(Schema.String),
              signature: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
  contentBlockStop: Schema.optional(Schema.Struct({ contentBlockIndex: Schema.Number })),
  messageStop: Schema.optional(
    Schema.Struct({
      stopReason: Schema.String,
      additionalModelResponseFields: Schema.optional(Schema.Unknown),
    }),
  ),
  metadata: Schema.optional(
    Schema.Struct({
      usage: Schema.optional(BedrockUsageSchema),
      metrics: Schema.optional(Schema.Unknown),
    }),
  ),
  internalServerException: Schema.optional(Schema.Struct({ message: Schema.String })),
  modelStreamErrorException: Schema.optional(Schema.Struct({ message: Schema.String })),
  validationException: Schema.optional(Schema.Struct({ message: Schema.String })),
  throttlingException: Schema.optional(Schema.Struct({ message: Schema.String })),
  serviceUnavailableException: Schema.optional(Schema.Struct({ message: Schema.String })),
});
export type BedrockEvent = Schema.Schema.Type<typeof BedrockEvent>;

const lowerToolSpec = (tool: ToolDefinition, inputSchema: JsonSchema): BedrockToolSpec => ({
  toolSpec: {
    name: tool.name,
    description: tool.description,
    inputSchema: { json: inputSchema },
  },
});

const lowerTools = (
  compatibility: ToolSchemaDialect | undefined,
  breakpoints: Breakpoints,
  tools: ReadonlyArray<ToolDefinition>,
): BedrockTool[] => {
  const result: BedrockTool[] = [];
  for (const tool of tools) {
    result.push(lowerToolSpec(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, compatibility)));
    const cachePoint = BedrockCache.block(breakpoints, tool.cache);
    if (cachePoint) result.push(cachePoint);
  }
  return result;
};

const textWithCache = (
  breakpoints: Breakpoints,
  text: string,
  cache: CacheHint | undefined,
): Array<BedrockTextBlock | BedrockCache.CachePointBlock> => {
  const cachePoint = BedrockCache.block(breakpoints, cache);
  return cachePoint ? [{ text }, cachePoint] : [{ text }];
};

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Bedrock Converse', toolChoice, {
    auto: () => ({ auto: {} }) as const,
    none: () => undefined,
    required: () => ({ any: {} }) as const,
    tool: (name) => ({ tool: { name } }) as const,
  });

export const bedrockMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ bedrock: metadata });

const reasoningSignature = (part: ReasoningPart) => {
  const bedrock = part.providerMetadata?.bedrock;
  return part.encrypted ?? (isRecord(bedrock) && typeof bedrock.signature === 'string' ? bedrock.signature : undefined);
};

const TOOL_ID = { outside: /[^A-Za-z0-9_.:-]/g, maxLength: 64 };

const lowerToolCall = (part: ToolCallPart): BedrockToolUseBlock => ({
  toolUse: {
    toolUseId: ProviderShared.toolId(part.id, TOOL_ID),
    name: part.name,
    input: part.input,
  },
});

const lowerToolResultContent = Effect.fn('BedrockConverse.lowerToolResultContent')(function* (part: ToolResultPart) {
  if (part.result.type === 'text' || part.result.type === 'error') return [{ text: ProviderShared.toolResultText(part) }];
  if (part.result.type === 'json') return [{ json: part.result.value }];

  const content: Array<Schema.Schema.Type<typeof BedrockToolResultContentItem>> = [];
  for (const item of part.result.value) {
    if (item.type === 'text') {
      content.push({ text: item.text });
      continue;
    }
    const media = yield* BedrockMedia.lower({
      type: 'media',
      mediaType: item.mime,
      data: item.uri,
      filename: item.name,
    });
    if (!('image' in media)) return yield* ProviderShared.invalidRequest('Bedrock Converse only supports image media in tool results');
    content.push(media);
  }
  return content;
});

const lowerToolResult = Effect.fn('BedrockConverse.lowerToolResult')(function* (part: ToolResultPart) {
  return {
    toolResult: {
      toolUseId: ProviderShared.toolId(part.id, TOOL_ID),
      content: yield* lowerToolResultContent(part),
      status: part.result.type === 'error' ? 'error' : 'success',
    },
  } satisfies BedrockToolResultBlock;
});

const lowerMessages = Effect.fn('BedrockConverse.lowerMessages')(function* (request: LLMRequest, breakpoints: Breakpoints) {
  const messages: BedrockMessage[] = [];

  for (const message of request.messages) {
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('Bedrock Converse', message);
      const content = textWithCache(breakpoints, part.text, part.cache);
      const previous = messages.at(-1);
      if (previous?.role === 'user') messages[messages.length - 1] = { role: 'user', content: [...previous.content, ...content] };
      else messages.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'user') {
      const content: BedrockUserBlock[] = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'media']))
          return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'user', ['text', 'media']);
        if (part.type === 'text') {
          content.push(...textWithCache(breakpoints, part.text, part.cache));
          continue;
        }
        if (part.type === 'media') {
          content.push(yield* BedrockMedia.lower(part));
          const cachePoint = BedrockCache.block(breakpoints, part.cache);
          if (cachePoint) content.push(cachePoint);
        }
      }
      messages.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const content: BedrockAssistantBlock[] = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'reasoning', 'tool-call']))
          return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'assistant', ['text', 'reasoning', 'tool-call']);
        if (part.type === 'text') {
          content.push(...textWithCache(breakpoints, part.text, part.cache));
          continue;
        }
        if (part.type === 'reasoning') {
          const signature = reasoningSignature(part);
          if (signature !== undefined) content.push({ reasoningContent: { reasoningText: { text: part.text, signature } } });
          continue;
        }
        if (part.type === 'tool-call') {
          content.push(lowerToolCall(part));
          const cachePoint = BedrockCache.block(breakpoints, part.cache);
          if (cachePoint) content.push(cachePoint);
        }
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
      continue;
    }

    const content: BedrockUserBlock[] = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'tool', ['tool-result']);
      content.push(yield* lowerToolResult(part));
      const cachePoint = BedrockCache.block(breakpoints, part.cache);
      if (cachePoint) content.push(cachePoint);
    }
    messages.push({ role: 'user', content });
  }

  return messages;
});

const lowerSystem = (breakpoints: Breakpoints, system: ReadonlyArray<LLMRequest['system'][number]>): BedrockSystemBlock[] =>
  system.flatMap((part) => textWithCache(breakpoints, part.text, part.cache));

const fromRequest = Effect.fn('BedrockConverse.fromRequest')(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined;
  const generation = request.generation;
  const breakpoints = BedrockCache.breakpoints();
  const toolConfig =
    request.tools.length > 0 && request.toolChoice?.type !== 'none'
      ? { tools: lowerTools(request.model.compatibility?.toolSchema, breakpoints, request.tools), toolChoice }
      : undefined;
  const system = request.system.length === 0 ? undefined : lowerSystem(breakpoints, request.system);
  const messages = yield* lowerMessages(request, breakpoints);
  if (breakpoints.dropped > 0) {
    yield* Effect.logWarning(
      `Bedrock Converse: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${BedrockCache.BEDROCK_BREAKPOINT_CAP} per request.`,
    );
  }
  return {
    modelId: request.model.id,
    messages,
    system,
    inferenceConfig:
      generation?.maxTokens === undefined &&
      generation?.temperature === undefined &&
      generation?.topP === undefined &&
      (generation?.stop === undefined || generation.stop.length === 0)
        ? undefined
        : {
            maxTokens: generation?.maxTokens,
            temperature: generation?.temperature,
            topP: generation?.topP,
            stopSequences: generation?.stop,
          },
    toolConfig,
    additionalModelRequestFields: generation?.topK === undefined ? undefined : { top_k: generation.topK },
  };
});

const framing = BedrockEventStream.framing(ADAPTER);

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: BedrockConverseBody,
    from: fromRequest,
  },
  stream: {
    event: BedrockEvent,
    initial: initialState,
    step,
    onHalt,
  },
  inlineCacheHints: true,
});

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path<BedrockConverseBody>(({ body }) => `/model/${encodeURIComponent(body.modelId)}/converse-stream`),
  auth: BedrockAuth.auth,
  framing,
});

export const sigV4Auth = BedrockAuth.sigV4;
