import { Effect } from 'effect';
import { CacheHint } from '../../schema/options';
import type { JsonSchema, ProviderMetadata } from '../../schema/ids';
import { type LLMRequest, type MediaPart, type ToolCallPart, type ToolDefinition, type ToolResultPart } from '../../schema/messages';
import type { ToolContent } from '../../schema/tool-content';
import * as ProviderShared from '../shared';
import { isRecord } from '../../utils/record';
import * as Cache from '../utils/cache';
import { ToolSchemaProjection } from '../utils/tool-schema';
import {
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicServerToolUseBlock,
  AnthropicServerToolResultType,
  AnthropicServerToolResultBlock,
  AnthropicFallbackBlock,
  AnthropicToolResultBlock,
  AnthropicUserBlock,
  AnthropicAssistantBlock,
  AnthropicMessage,
  AnthropicTool,
  AnthropicThinkingDisplays,
  type AnthropicThinkingDisplay,
  AnthropicEfforts,
  type AnthropicEffort,
} from '../anthropic-messages';

const invalid = ProviderShared.invalidRequest;

const ANTHROPIC_BREAKPOINT_CAP = 4;

const TOOL_ID = { outside: /[^A-Za-z0-9_-]/g };

const EPHEMERAL_5M = { type: 'ephemeral' as const };
const EPHEMERAL_1H = { type: 'ephemeral' as const, ttl: '1h' as const };

const cacheControl = (breakpoints: Cache.Breakpoints, cache: CacheHint | undefined) => {
  if (cache?.type !== 'ephemeral' && cache?.type !== 'persistent') return undefined;
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1;
    return undefined;
  }
  breakpoints.remaining -= 1;
  return Cache.ttlBucket(cache.ttlSeconds) === '1h' ? EPHEMERAL_1H : EPHEMERAL_5M;
};

const emptyTools = (request: LLMRequest): ReadonlyArray<AnthropicTool> | undefined =>
  request.tools.length === 0 && request.toolChoice?.type !== 'none' && anthropicOptions(request)?.preserveEmptyTools === true
    ? []
    : undefined;

const signatureFromMetadata = (metadata: ProviderMetadata | undefined): string | undefined => {
  const anthropic = metadata?.anthropic;
  if (!isRecord(anthropic)) return undefined;
  return typeof anthropic.signature === 'string' ? anthropic.signature : undefined;
};

const lowerTool = (breakpoints: Cache.Breakpoints, tool: ToolDefinition, inputSchema: JsonSchema): AnthropicTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: inputSchema,
  defer_loading: tool.deferred === true ? true : undefined,
  eager_input_streaming: toolEagerInput(tool) ? true : undefined,
  cache_control: cacheControl(breakpoints, tool.cache),
});

const toolEagerInput = (tool: ToolDefinition): boolean => {
  const anthropic = isRecord(tool.native?.['anthropic']) ? tool.native?.['anthropic'] : undefined;
  return isRecord(anthropic) && anthropic.eagerInputStreaming === true;
};

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Anthropic Messages', toolChoice, {
    auto: () => ({ type: 'auto' as const }),
    none: () => undefined,
    required: () => ({ type: 'any' as const }),
    tool: (name) => ({ type: 'tool' as const, name }),
  });

const lowerToolCall = (part: ToolCallPart): AnthropicToolUseBlock => ({
  type: 'tool_use',
  id: ProviderShared.toolId(part.id, TOOL_ID),
  name: part.name,
  input: part.input,
  caller: part.providerMetadata?.anthropic?.caller as Record<string, unknown> | undefined,
});

const lowerServerToolCall = (part: ToolCallPart): AnthropicServerToolUseBlock => ({
  type: 'server_tool_use',
  id: ProviderShared.toolId(part.id, TOOL_ID),
  name: part.name,
  input: part.input,
});

const lowerModelFallback = (
  part: Extract<LLMRequest['messages'][number]['content'][number], { type: 'model-fallback' }>,
): AnthropicFallbackBlock => ({
  type: 'fallback',
  from: { model: part.from.model },
  to: { model: part.to.model },
});

const serverToolResultType = (name: string): AnthropicServerToolResultType | undefined => {
  if (name === 'web_search') return 'web_search_tool_result';
  if (name === 'code_execution') return 'code_execution_tool_result';
  if (name === 'web_fetch') return 'web_fetch_tool_result';
  return undefined;
};

const lowerServerToolResult = Effect.fn('AnthropicMessages.lowerServerToolResult')(function* (part: ToolResultPart) {
  const wireType = serverToolResultType(part.name);
  if (!wireType) return yield* invalid(`Anthropic Messages does not know how to round-trip server tool result for ${part.name}`);
  return {
    type: wireType,
    tool_use_id: ProviderShared.toolId(part.id, TOOL_ID),
    content: part.result.value,
  } satisfies AnthropicServerToolResultBlock;
});

const lowerImage = Effect.fn('AnthropicMessages.lowerImage')(function* (part: MediaPart) {
  const media = yield* ProviderShared.validateMedia('Anthropic Messages', part, new Set<string>(ProviderShared.IMAGE_MIMES));
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: media.mime,
      data: media.base64,
    },
  } satisfies AnthropicImageBlock;
});

const lowerToolResultContentItem = Effect.fn('AnthropicMessages.lowerToolResultContentItem')(function* (item: ToolContent) {
  if (item.type === 'text') return { type: 'text' as const, text: item.text } satisfies AnthropicTextBlock;
  const media = yield* ProviderShared.validateToolFile('Anthropic Messages', item, new Set<string>(ProviderShared.IMAGE_MIMES));
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: media.mime,
      data: media.base64,
    },
  } satisfies AnthropicImageBlock;
});

const declaredDeferred = (request: LLMRequest): ReadonlySet<string> =>
  new Set(request.toolChoice?.type === 'none' ? [] : request.tools.flatMap((tool) => (tool.deferred ? [tool.name] : [])));

const lowerToolResultContent = Effect.fn('AnthropicMessages.lowerToolResultContent')(function* (
  part: ToolResultPart,
  deferred: ReadonlySet<string>,
) {
  const references = part.toolReferences?.filter((name) => deferred.has(name)) ?? [];
  if (references.length > 0) {
    if (part.result.type === 'error') return yield* invalid('Anthropic tool references require a successful tool result.');
    const content =
      part.result.type === 'content'
        ? yield* Effect.forEach(part.result.value, lowerToolResultContentItem)
        : [{ type: 'text' as const, text: ProviderShared.toolResultText(part) }];
    return [...references.map((name) => ({ type: 'tool_reference' as const, tool_name: name })), ...content];
  }
  if (part.result.type !== 'content') {
    const text = ProviderShared.toolResultText(part);
    if (part.result.type === 'error' && text.length === 0) return `The ${part.name} tool failed and reported no message.`;
    return text;
  }
  const content: ReadonlyArray<ToolContent> = part.result.value;
  return yield* Effect.forEach(content, lowerToolResultContentItem);
});

const isNativeSystemUpdate = (message: LLMRequest['messages'][number]): boolean => {
  const anthropic = isRecord(message.native?.['anthropic']) ? message.native?.['anthropic'] : undefined;
  return isRecord(anthropic) && anthropic.system === true;
};

const nativeMessageFormat = (message: LLMRequest['messages'][number]): 'string' | 'blocks' => {
  const anthropic = isRecord(message.native?.['anthropic']) ? message.native?.['anthropic'] : undefined;
  return isRecord(anthropic) && anthropic.format === 'string' ? 'string' : 'blocks';
};

const nativeSystemOutputConfig = Effect.fn('AnthropicMessages.nativeSystemOutputConfig')(function* (
  message: LLMRequest['messages'][number],
) {
  const anthropic = isRecord(message.native?.['anthropic']) ? message.native?.['anthropic'] : undefined;
  if (!isRecord(anthropic) || anthropic.outputConfig === undefined) return undefined;
  const output = anthropic.outputConfig;
  if (!isRecord(output)) return yield* invalid('Anthropic native system outputConfig requires an effort');
  const effort = output.effort;
  if (typeof effort !== 'string' || !(AnthropicEfforts as readonly string[]).includes(effort)) {
    return yield* invalid(`Anthropic native system effort must be one of ${AnthropicEfforts.join(', ')}`);
  }
  return { effort: effort as AnthropicEffort };
});

const canUseNativeSystemUpdate = (previous: AnthropicMessage | undefined, next: 'user' | 'assistant' | undefined) =>
  previous !== undefined &&
  (previous.role === 'user' || (previous.role === 'assistant' && previous.content.at(-1)?.type === 'server_tool_use')) &&
  (next === undefined || next === 'assistant');

const lowerNativeSystemUpdate = Effect.fn('AnthropicMessages.lowerNativeSystemUpdate')(function* (
  message: LLMRequest['messages'][number],
  breakpoints: Cache.Breakpoints,
  outputConfig: { readonly effort: AnthropicEffort } | undefined,
) {
  const content = yield* ProviderShared.systemUpdateText('Anthropic Messages', message);
  const native = message.native?.['anthropic'];
  const clearAt = isRecord(native) ? native.clearAt : undefined;
  if (clearAt !== undefined && clearAt !== 'next_user_message')
    return yield* invalid('Anthropic native system clearAt must be next_user_message');
  if (nativeMessageFormat(message) === 'string' && (content.length > 0 || outputConfig === undefined)) {
    return {
      role: 'system' as const,
      content: content.map((part) => part.text).join('\n'),
      output_config: outputConfig,
      clear_at: clearAt === undefined ? undefined : ('next_user_message' as const),
    };
  }
  return {
    role: 'system' as const,
    content: content.map((part) => ({
      type: 'text' as const,
      text: part.text,
      cache_control: cacheControl(breakpoints, part.cache),
    })),
    output_config: outputConfig,
    clear_at: clearAt === undefined ? undefined : ('next_user_message' as const),
  };
});

const lowerMessages = Effect.fn('AnthropicMessages.lowerMessages')(function* (request: LLMRequest, breakpoints: Cache.Breakpoints) {
  const messages: AnthropicMessage[] = [];
  const deferred = declaredDeferred(request);
  const pending = new Set<string>();
  const history = request.messages.filter(
    (message) =>
      message.role !== 'assistant' ||
      message.content.some(
        (part) => part.type !== 'reasoning' || (part.encrypted ?? signatureFromMetadata(part.providerMetadata)) !== undefined,
      ),
  );
  const successors: Array<'user' | 'assistant' | undefined> = new Array(history.length);
  let next: 'user' | 'assistant' | undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    successors[index] = next;
    const message = history[index]!;
    if (message.role !== 'system' || !isNativeSystemUpdate(message)) next = message.role === 'assistant' ? 'assistant' : 'user';
  }
  let preceding: AnthropicMessage | undefined;
  let wrappedContent: AnthropicUserBlock[] | undefined;

  for (const [index, message] of history.entries()) {
    if (message.role === 'system') {
      const native = isNativeSystemUpdate(message);
      const outputConfig = native ? yield* nativeSystemOutputConfig(message) : undefined;
      const directive = message.content.length === 0 && outputConfig !== undefined;
      if (!directive && pending.size > 0)
        return yield* invalid('Anthropic Messages system updates cannot split a local tool call from its tool result');
      if (directive || (native && canUseNativeSystemUpdate(preceding, successors[index]))) {
        messages.push(yield* lowerNativeSystemUpdate(message, breakpoints, outputConfig));
        wrappedContent = undefined;
        continue;
      }
      const part = yield* ProviderShared.wrappedSystemUpdate('Anthropic Messages', message);
      const block = { type: 'text' as const, text: part.text, cache_control: cacheControl(breakpoints, part.cache) };
      const previous = messages.at(-1);
      if (previous?.role === 'user') {
        if (wrappedContent === undefined) {
          wrappedContent = typeof previous.content === 'string' ? [{ type: 'text', text: previous.content }] : [...previous.content];
          messages[messages.length - 1] = { role: 'user', content: wrappedContent };
        }
        wrappedContent.push(block);
      } else {
        wrappedContent = [block];
        messages.push({ role: 'user', content: wrappedContent });
      }
      preceding = messages.at(-1);
      if (outputConfig !== undefined) {
        messages.push({ role: 'system', content: [], output_config: outputConfig });
        wrappedContent = undefined;
      }
      continue;
    }
    wrappedContent = undefined;

    if (message.role === 'user') {
      if (nativeMessageFormat(message) === 'string') {
        if (message.content.some((part) => part.type !== 'text')) return yield* invalid('Anthropic string content requires text parts.');
        messages.push({ role: 'user', content: message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n') });
        preceding = messages.at(-1);
        continue;
      }
      const content: AnthropicUserBlock[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text, cache_control: cacheControl(breakpoints, part.cache) });
          continue;
        }
        if (part.type === 'media') {
          content.push({ ...(yield* lowerImage(part)), cache_control: cacheControl(breakpoints, part.cache) });
          continue;
        }
        return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'user', ['text', 'media']);
      }
      messages.push({ role: 'user', content });
      preceding = messages.at(-1);
      continue;
    }

    if (message.role === 'assistant') {
      const content: AnthropicAssistantBlock[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text, cache_control: cacheControl(breakpoints, part.cache) });
          continue;
        }
        if (part.type === 'reasoning') {
          const signature = part.encrypted ?? signatureFromMetadata(part.providerMetadata);
          if (signature !== undefined) content.push({ type: 'thinking', thinking: part.text, signature });
          continue;
        }
        if (part.type === 'tool-call') {
          if (part.providerExecuted !== true) pending.add(part.id);
          const block = part.providerExecuted ? lowerServerToolCall(part) : lowerToolCall(part);
          content.push({ ...block, cache_control: cacheControl(breakpoints, part.cache) });
          continue;
        }
        if (part.type === 'model-fallback') {
          content.push(lowerModelFallback(part));
          continue;
        }
        if (part.type === 'tool-result' && part.providerExecuted) {
          content.push({ ...(yield* lowerServerToolResult(part)), cache_control: cacheControl(breakpoints, part.cache) });
          continue;
        }
        return yield* invalid(`Anthropic Messages assistant messages only support text, reasoning, and tool-call content for now`);
      }
      messages.push({ role: 'assistant', content });
      preceding = messages.at(-1);
      continue;
    }

    const content: AnthropicToolResultBlock[] = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'tool', ['tool-result']);
      pending.delete(part.id);
      content.push({
        type: 'tool_result',
        tool_use_id: ProviderShared.toolId(part.id, TOOL_ID),
        content: yield* lowerToolResultContent(part, deferred),
        is_error: part.result.type === 'error' ? true : undefined,
        cache_control: cacheControl(breakpoints, part.cache),
      });
    }
    messages.push({ role: 'user', content });
    preceding = messages.at(-1);
  }

  return messages;
});

const anthropicOptions = (request: LLMRequest) => request.providerOptions?.anthropic;

const disableParallelToolUse = (request: LLMRequest) => {
  const value = anthropicOptions(request)?.disableParallelToolUse;
  return value === true ? true : undefined;
};

const userId = (request: LLMRequest) => {
  const value = anthropicOptions(request)?.userId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const lowerThinking = Effect.fn('AnthropicMessages.lowerThinking')(function* (request: LLMRequest) {
  const thinking = anthropicOptions(request)?.thinking;
  if (!isRecord(thinking)) return undefined;
  if (thinking.type === 'disabled') return { type: 'disabled' as const };
  if (thinking.type === 'adaptive') {
    const display = thinking.display;
    return typeof display === 'string' && (AnthropicThinkingDisplays as readonly string[]).includes(display)
      ? { type: 'adaptive' as const, display: display as AnthropicThinkingDisplay }
      : { type: 'adaptive' as const };
  }
  if (thinking.type !== 'enabled') return undefined;
  const budget =
    typeof thinking.budgetTokens === 'number'
      ? thinking.budgetTokens
      : typeof thinking.budget_tokens === 'number'
        ? thinking.budget_tokens
        : undefined;
  if (budget === undefined) return yield* invalid('Anthropic thinking provider option requires budgetTokens');
  return { type: 'enabled' as const, budget_tokens: budget };
});

const lowerOutputConfig = Effect.fn('AnthropicMessages.lowerOutputConfig')(function* (request: LLMRequest) {
  const declared = anthropicOptions(request)?.outputConfig;
  if (declared === undefined) return undefined;
  if (!isRecord(declared)) return yield* invalid('Anthropic outputConfig provider option requires an effort or a format');
  const { effort, format } = declared as { effort?: unknown; format?: unknown };
  if (effort !== undefined && format !== undefined)
    return yield* invalid('Anthropic outputConfig carries either an effort or a format, never both');
  if (effort !== undefined) {
    if (typeof effort !== 'string' || !(AnthropicEfforts as readonly string[]).includes(effort))
      return yield* invalid(`Anthropic effort provider option must be one of ${AnthropicEfforts.join(', ')}; received ${String(effort)}`);
    return { effort: effort as AnthropicEffort };
  }
  if (format !== undefined) {
    if (!isRecord(format)) return yield* invalid('Anthropic outputConfig format provider option requires a JSON schema object');
    return { format };
  }
  return undefined;
});

const lowerContextManagement = Effect.fn('AnthropicMessages.lowerContextManagement')(function* (request: LLMRequest) {
  const declared = anthropicOptions(request)?.contextManagement;
  if (declared === undefined) return undefined;
  if (!isRecord(declared) || !Array.isArray(declared.edits))
    return yield* invalid('Anthropic contextManagement provider option requires an edits list');
  const edits: { type: string; keep?: string }[] = [];
  for (const edit of declared.edits) {
    if (!isRecord(edit) || typeof edit.type !== 'string') return yield* invalid('Anthropic contextManagement edits each require a type');
    edits.push({ type: edit.type, keep: typeof edit.keep === 'string' ? edit.keep : undefined });
  }
  return { edits };
});

const lowerThread = Effect.fn('AnthropicMessages.lowerThread')(function* (request: LLMRequest) {
  const declared = anthropicOptions(request)?.thread;
  if (declared === undefined) return undefined;
  if (!isRecord(declared) || (declared.type !== 'create' && declared.type !== 'continue'))
    return yield* invalid('Anthropic thread provider option requires a create or continue shape');
  if (declared.type === 'create') return { type: 'create' as const };
  if (typeof declared.previous_message_id !== 'string' || declared.previous_message_id.length === 0)
    return yield* invalid('Anthropic thread continue requires the previous message id');
  return { type: 'continue' as const, previous_message_id: declared.previous_message_id };
});

const lowerDiagnostics = Effect.fn('AnthropicMessages.lowerDiagnostics')(function* (request: LLMRequest) {
  const declared = anthropicOptions(request)?.diagnostics;
  if (declared === undefined) return undefined;
  if (!isRecord(declared) || (typeof declared.previous_message_id !== 'string' && declared.previous_message_id !== null))
    return yield* invalid('Anthropic diagnostics provider option requires a previous message id or null');
  return { previous_message_id: declared.previous_message_id };
});

const lowerFallbacks = Effect.fn('AnthropicMessages.lowerFallbacks')(function* (request: LLMRequest) {
  const declared = anthropicOptions(request)?.fallbacks;
  if (declared === undefined) return undefined;
  if (declared === 'default') return 'default' as const;
  if (
    !Array.isArray(declared) ||
    !declared.every((entry): entry is { model: string } => isRecord(entry) && typeof entry.model === 'string')
  )
    return yield* invalid('Anthropic fallbacks provider option requires default or a model list');
  return declared.map((entry) => ({ model: entry.model }));
});

export const fromRequest = Effect.fn('AnthropicMessages.fromRequest')(function* (request: LLMRequest) {
  const chosen = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined;
  const generation = request.generation;
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema;
  const outputLimit = request.model.defaults?.limits?.output ?? request.model.route.defaults.limits?.output ?? 4096;
  const breakpoints = Cache.newBreakpoints(ANTHROPIC_BREAKPOINT_CAP);
  const tools =
    request.tools.length === 0 || request.toolChoice?.type === 'none'
      ? emptyTools(request)
      : request.tools.map((tool) =>
          lowerTool(
            breakpoints,
            tool,
            ToolSchemaProjection.flatRootObject(ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility)),
          ),
        );
  const declared = request.system.map((part) => ({
    type: 'text' as const,
    text: part.text,
    cache_control: cacheControl(breakpoints, part.cache),
  }));
  const system = declared.length === 0 ? undefined : declared;
  const messages = yield* lowerMessages(request, breakpoints);
  if (breakpoints.dropped > 0) {
    yield* Effect.logWarning(
      `Anthropic Messages: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${ANTHROPIC_BREAKPOINT_CAP} per request.`,
    );
  }
  const serial = tools === undefined ? undefined : disableParallelToolUse(request);
  const toolChoice = serial === undefined ? chosen : { ...(chosen ?? { type: 'auto' as const }), disable_parallel_tool_use: serial };
  const identity = userId(request);
  const thread = yield* lowerThread(request);
  const diagnostics = yield* lowerDiagnostics(request);
  const fallbacks = yield* lowerFallbacks(request);
  return {
    model: request.model.id,
    system,
    metadata: identity === undefined ? undefined : { user_id: identity },
    messages,
    tools,
    tool_choice: toolChoice,
    stream: anthropicOptions(request)?.stream !== false,
    max_tokens: generation?.maxTokens ?? outputLimit,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    top_k: generation?.topK,
    stop_sequences: generation?.stop,
    thinking: yield* lowerThinking(request),
    output_config: yield* lowerOutputConfig(request),
    context_management: yield* lowerContextManagement(request),
    thread,
    diagnostics,
    fallbacks,
  };
});
