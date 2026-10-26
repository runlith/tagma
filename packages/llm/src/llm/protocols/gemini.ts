import { Effect, Schema } from 'effect';
import * as Auth from '../route/auth';
import { Route } from '../route/definition';
import { Endpoint } from '../route/endpoint';
import * as Framing from '../route/framing';
import * as Protocol from '../route/protocol';
import type { FinishReason, JsonSchema, ProviderMetadata } from '../schema/ids';
import { LLMEvent, Usage } from '../schema/events';
import type { LLMRequest, MediaPart, TextPart, ToolCallPart, ToolDefinition } from '../schema/messages';
import type { ProviderOptions } from '../schema/options';
import { isContextOverflow } from '../provider-error';
import type { ToolContent } from '../schema/tool-content';
import * as ProviderShared from './shared';
import { JsonObject, optionalArray } from './shared';
import { isRecord } from '../utils/record';
import * as GeminiToolSchema from './gemini/toolSchema';
import * as Lifecycle from './utils/lifecycle';
import { ToolSchemaProjection } from './utils/tool-schema';

const ADAPTER = 'gemini';
const MEDIA_MIMES = new Set<string>(ProviderShared.MEDIA_MIMES);
export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const GeminiTextPart = Schema.Struct({
  text: Schema.String,
  thought: Schema.optional(Schema.Boolean),
  thoughtSignature: Schema.optional(Schema.String),
});

const GeminiInlineDataPart = Schema.Struct({
  inlineData: Schema.Struct({
    mimeType: Schema.String,
    data: Schema.String,
  }),
});

const GeminiFunctionCallPart = Schema.Struct({
  functionCall: Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.String,
    args: Schema.Unknown,
  }),
  thoughtSignature: Schema.optional(Schema.String),
});

const GeminiFunctionResponsePart = Schema.Struct({
  functionResponse: Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.String,
    response: Schema.Unknown,
    parts: optionalArray(GeminiInlineDataPart),
  }),
});

const GeminiContentPart = Schema.Union([GeminiTextPart, GeminiInlineDataPart, GeminiFunctionCallPart, GeminiFunctionResponsePart]);

const GeminiContent = Schema.Struct({
  role: Schema.Literals(['user', 'model']),
  parts: Schema.Array(GeminiContentPart),
});
type GeminiContent = Schema.Schema.Type<typeof GeminiContent>;

const GeminiSystemInstruction = Schema.Struct({
  parts: Schema.Array(Schema.Struct({ text: Schema.String })),
});

const GeminiFunctionDeclaration = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.optional(JsonObject),
});

const GeminiTool = Schema.Struct({
  functionDeclarations: Schema.Array(GeminiFunctionDeclaration),
});

const GeminiToolConfig = Schema.Struct({
  functionCallingConfig: Schema.Struct({
    mode: Schema.Literals(['AUTO', 'NONE', 'ANY']),
    allowedFunctionNames: optionalArray(Schema.String),
  }),
});

const GeminiThinkingLevel = Schema.Literals(['minimal', 'low', 'medium', 'high']);
export type GeminiThinkingLevel = Schema.Schema.Type<typeof GeminiThinkingLevel>;
const isThinkingLevel = Schema.is(GeminiThinkingLevel);

const GeminiThinkingConfig = Schema.Struct({
  thinkingLevel: Schema.optional(GeminiThinkingLevel),
  thinkingBudget: Schema.optional(Schema.Number),
  includeThoughts: Schema.optional(Schema.Boolean),
});
type GeminiThinkingConfig = Schema.Schema.Type<typeof GeminiThinkingConfig>;

const GeminiGenerationConfig = Schema.Struct({
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  stopSequences: optionalArray(Schema.String),
  thinkingConfig: Schema.optional(GeminiThinkingConfig),
});

const GeminiBodyFields = {
  contents: Schema.Array(GeminiContent),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: optionalArray(GeminiTool),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
};
const GeminiBody = Schema.Struct(GeminiBodyFields);
export type GeminiBody = Schema.Schema.Type<typeof GeminiBody>;

const GeminiUsage = Schema.Struct({
  cachedContentTokenCount: Schema.optional(Schema.Number),
  thoughtsTokenCount: Schema.optional(Schema.Number),
  promptTokenCount: Schema.optional(Schema.Number),
  toolUsePromptTokenCount: Schema.optional(Schema.Number),
  candidatesTokenCount: Schema.optional(Schema.Number),
  totalTokenCount: Schema.optional(Schema.Number),
});
type GeminiUsage = Schema.Schema.Type<typeof GeminiUsage>;

const GeminiCandidate = Schema.Struct({
  content: Schema.optional(GeminiContent),
  finishReason: Schema.optional(Schema.String),
});

const GeminiError = Schema.Struct({
  code: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
type GeminiError = Schema.Schema.Type<typeof GeminiError>;

const GeminiEvent = Schema.Struct({
  candidates: optionalArray(GeminiCandidate),
  promptFeedback: Schema.optional(Schema.Struct({ blockReason: Schema.optional(Schema.String) })),
  usageMetadata: Schema.optional(GeminiUsage),
  error: Schema.optional(GeminiError),
});
type GeminiEvent = Schema.Schema.Type<typeof GeminiEvent>;

interface ParserState {
  readonly finishReason?: string;
  readonly blockReason?: string;
  readonly hasToolCalls: boolean;
  readonly usage?: Usage;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningSignature?: string;
  readonly textSignature?: string;
}

const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema) => ({
  name: tool.name,
  description: tool.description,
  parameters: GeminiToolSchema.convert(inputSchema),
});

const lowerToolConfig = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Gemini', toolChoice, {
    auto: () => ({ functionCallingConfig: { mode: 'AUTO' as const } }),
    none: () => ({ functionCallingConfig: { mode: 'NONE' as const } }),
    required: () => ({ functionCallingConfig: { mode: 'ANY' as const } }),
    tool: (name) => ({ functionCallingConfig: { mode: 'ANY' as const, allowedFunctionNames: [name] } }),
  });

const lowerUserPart = Effect.fn('Gemini.lowerUserPart')(function* (part: TextPart | MediaPart) {
  if (part.type === 'text') return { text: part.text };
  const media = yield* ProviderShared.validateMedia('Gemini', part, MEDIA_MIMES);
  return { inlineData: { mimeType: media.mime, data: media.base64 } };
});

const googleMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ google: metadata });

const thoughtSignature = (providerMetadata: ProviderMetadata | undefined) => {
  const google = providerMetadata?.google;
  return isRecord(google) && typeof google.thoughtSignature === 'string' ? google.thoughtSignature : undefined;
};

const lowerToolCall = (part: ToolCallPart) => ({
  functionCall: { id: part.id, name: part.name, args: part.input },
  thoughtSignature: thoughtSignature(part.providerMetadata),
});

const lowerMessages = Effect.fn('Gemini.lowerMessages')(function* (request: LLMRequest) {
  const contents: GeminiContent[] = [];

  for (const message of request.messages) {
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('Gemini', message);
      const previous = contents.at(-1);
      if (previous?.role === 'user' && !previous.parts.some((item) => 'functionResponse' in item))
        contents[contents.length - 1] = { role: 'user', parts: [...previous.parts, { text: part.text }] };
      else contents.push({ role: 'user', parts: [{ text: part.text }] });
      continue;
    }

    if (message.role === 'user') {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'media']))
          return yield* ProviderShared.unsupportedContent('Gemini', 'user', ['text', 'media']);
        parts.push(yield* lowerUserPart(part));
      }
      contents.push({ role: 'user', parts });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'reasoning', 'tool-call']))
          return yield* ProviderShared.unsupportedContent('Gemini', 'assistant', ['text', 'reasoning', 'tool-call']);
        if (part.type === 'text') {
          parts.push({ text: part.text, thoughtSignature: thoughtSignature(part.providerMetadata) });
          continue;
        }
        if (part.type === 'reasoning') {
          parts.push({ text: part.text, thought: true, thoughtSignature: thoughtSignature(part.providerMetadata) });
          continue;
        }
        if (part.type === 'tool-call') {
          parts.push(lowerToolCall(part));
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Gemini', 'tool', ['tool-result']);
      if (part.result.type !== 'content') {
        parts.push({
          functionResponse: {
            id: part.id,
            name: part.name,
            response: {
              name: part.name,
              content: ProviderShared.toolResultText(part),
            },
          },
        });
        continue;
      }
      const content: ReadonlyArray<ToolContent> = part.result.value;
      const text = content.filter((item) => item.type === 'text').map((item) => item.text);
      const media: Array<Schema.Schema.Type<typeof GeminiInlineDataPart>> = [];
      for (const item of content) {
        if (item.type === 'text') continue;
        const file = yield* ProviderShared.validateToolFile('Gemini', item, MEDIA_MIMES);
        media.push({ inlineData: { mimeType: file.mime, data: file.base64 } });
      }
      parts.push({
        functionResponse: {
          id: part.id,
          name: part.name,
          response: {
            name: part.name,
            content: text.join('\n'),
          },
          parts: media.length === 0 ? undefined : media,
        },
      });
    }
    contents.push({ role: 'user', parts });
  }

  return contents;
});

const geminiOptions = (request: LLMRequest) => request.providerOptions?.gemini;

const thinkingConfig = (request: LLMRequest) => {
  const value = geminiOptions(request)?.thinkingConfig;
  if (!isRecord(value)) return undefined;
  const result = {
    thinkingLevel: isThinkingLevel(value.thinkingLevel) ? value.thinkingLevel : undefined,
    thinkingBudget: typeof value.thinkingBudget === 'number' ? value.thinkingBudget : undefined,
    includeThoughts: typeof value.includeThoughts === 'boolean' ? value.includeThoughts : undefined,
  };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
};

export const options = (input: { readonly thinkingConfig?: GeminiThinkingConfig | undefined }): ProviderOptions | undefined =>
  input.thinkingConfig === undefined ? undefined : { gemini: { thinkingConfig: input.thinkingConfig } };

const fromRequest = Effect.fn('Gemini.fromRequest')(function* (request: LLMRequest) {
  const toolsEnabled = request.tools.length > 0 && request.toolChoice?.type !== 'none';
  const generation = request.generation;
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema;
  const generationConfig = {
    maxOutputTokens: generation?.maxTokens,
    temperature: generation?.temperature,
    topP: generation?.topP,
    topK: generation?.topK,
    stopSequences: generation?.stop,
    thinkingConfig: thinkingConfig(request),
  };

  return {
    contents: yield* lowerMessages(request),
    systemInstruction: request.system.length === 0 ? undefined : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: toolsEnabled
      ? [
          {
            functionDeclarations: request.tools.map((tool) =>
              lowerTool(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility)),
            ),
          },
        ]
      : undefined,
    toolConfig: toolsEnabled && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined) ? generationConfig : undefined,
  };
});

const mapUsage = (usage: GeminiUsage | undefined) => {
  if (!usage) return undefined;
  const cached = usage.cachedContentTokenCount;
  const inputTokens = usage.promptTokenCount !== undefined ? usage.promptTokenCount + (usage.toolUsePromptTokenCount ?? 0) : undefined;
  const nonCached = ProviderShared.subtractTokens(inputTokens, cached);
  const outputTokens = usage.candidatesTokenCount !== undefined ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) : undefined;
  return new Usage({
    inputTokens,
    outputTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: usage.thoughtsTokenCount,
    totalTokens: ProviderShared.totalTokens(inputTokens, outputTokens, usage.totalTokenCount),
    providerMetadata: { google: usage },
  });
};

const FILTERED: ReadonlySet<string> = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'ESCALATION',
  'PUP_LIMITED_DISABLED',
]);

const FAILED: ReadonlySet<string> = new Set([
  'MALFORMED_FUNCTION_CALL',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS',
  'MISSING_THOUGHT_SIGNATURE',
  'MALFORMED_RESPONSE',
]);

const mapFinishReason = (state: ParserState): FinishReason => {
  if (state.blockReason !== undefined) return 'content-filter';
  const reason = state.finishReason;
  if (reason === 'STOP') return state.hasToolCalls ? 'tool-calls' : 'stop';
  if (reason === 'MAX_TOKENS' || reason === 'CONTINUATION') return 'length';
  if (reason !== undefined && FILTERED.has(reason)) return 'content-filter';
  if (reason !== undefined && FAILED.has(reason)) return 'error';
  return 'unknown';
};

const finish = (state: ParserState): ReadonlyArray<LLMEvent> => {
  if (state.finishReason === undefined && state.blockReason === undefined) return [];
  const events: LLMEvent[] = [];
  let lifecycle = state.reasoningSignature
    ? Lifecycle.reasoningEnd(state.lifecycle, events, 'reasoning-0', googleMetadata({ thoughtSignature: state.reasoningSignature }))
    : state.lifecycle;
  if (state.textSignature !== undefined) {
    lifecycle = Lifecycle.textEnd(
      lifecycle.text.has('text-0') ? lifecycle : Lifecycle.textDelta(lifecycle, events, 'text-0', ''),
      events,
      'text-0',
      googleMetadata({ thoughtSignature: state.textSignature }),
    );
  }
  Lifecycle.finish(lifecycle, events, { reason: mapFinishReason(state), usage: state.usage });
  return events;
};

const RETRYABLE_STATUSES: ReadonlySet<string> = new Set(['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'DEADLINE_EXCEEDED']);

const streamFailure = (state: ParserState, event: GeminiEvent, error: GeminiError) => {
  const message = error.message ?? '';
  return ProviderShared.providerStreamFailure({
    module: 'Gemini',
    refusal: { code: error.status ?? (error.code === undefined ? undefined : String(error.code)), message },
    evidence: { eventType: undefined, keys: Object.keys(event), payloadKeys: Object.keys(error) },
    retryable: (error.status !== undefined && RETRYABLE_STATUSES.has(error.status)) || (error.code !== undefined && error.code >= 500),
    contextOverflow: isContextOverflow(message),
    modelStarted: state.lifecycle.stepStarted,
  });
};

const step = (state: ParserState, event: GeminiEvent) => {
  if (event.error !== undefined) return Effect.fail(streamFailure(state, event, event.error));
  const nextState = {
    ...state,
    usage: event.usageMetadata ? (mapUsage(event.usageMetadata) ?? state.usage) : state.usage,
    blockReason: event.promptFeedback?.blockReason ?? state.blockReason,
  };
  const candidate = event.candidates?.[0];
  if (!candidate?.content)
    return Effect.succeed([{ ...nextState, finishReason: candidate?.finishReason ?? nextState.finishReason }, []] as const);

  const events: LLMEvent[] = [];
  let hasToolCalls = nextState.hasToolCalls;
  let lifecycle = nextState.lifecycle;
  let reasoningSignature = nextState.reasoningSignature;
  let textSignature = nextState.textSignature;

  for (const part of candidate.content.parts) {
    if ('text' in part && part.thoughtSignature) {
      if (part.thought) reasoningSignature = part.thoughtSignature;
      else textSignature = part.thoughtSignature;
    }
    if ('text' in part && part.text.length > 0) {
      if (part.thought) {
        lifecycle = Lifecycle.reasoningDelta(
          lifecycle,
          events,
          'reasoning-0',
          part.text,
          part.thoughtSignature ? googleMetadata({ thoughtSignature: part.thoughtSignature }) : undefined,
        );
        continue;
      }
      lifecycle = Lifecycle.reasoningEnd(
        lifecycle,
        events,
        'reasoning-0',
        reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
      );
      lifecycle = Lifecycle.textDelta(lifecycle, events, 'text-0', part.text);
      continue;
    }

    if ('functionCall' in part) {
      const input = part.functionCall.args;
      const id = part.functionCall.id ?? `tool_${crypto.randomUUID()}`;
      lifecycle = Lifecycle.reasoningEnd(
        lifecycle,
        events,
        'reasoning-0',
        reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
      );
      lifecycle = Lifecycle.stepStart(lifecycle, events);
      events.push(
        LLMEvent.toolCall({
          id,
          name: part.functionCall.name,
          input,
          providerMetadata: part.thoughtSignature ? googleMetadata({ thoughtSignature: part.thoughtSignature }) : undefined,
        }),
      );
      hasToolCalls = true;
    }
  }

  return Effect.succeed([
    {
      ...nextState,
      hasToolCalls,
      lifecycle,
      reasoningSignature,
      textSignature,
      finishReason: candidate.finishReason ?? nextState.finishReason,
    },
    events,
  ] as const);
};

export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: GeminiBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(GeminiEvent),
    initial: () => ({ hasToolCalls: false, lifecycle: Lifecycle.initial() }),
    step,
    onHalt: finish,
  },
});

export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path(({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`, {
    baseURL: DEFAULT_BASE_URL,
  }),
  auth: Auth.none,
  framing: Framing.sse,
});
