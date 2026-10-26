import { Effect } from 'effect';
import type { JsonSchema } from '../../schema/ids';
import {
  type LLMRequest,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
  type VendorWire,
} from '../../schema/messages';
import { vendorWires } from './wires';
import type { ToolContent } from '../../schema/tool-content';
import * as ProviderShared from '../shared';
import { isRecord } from '../../utils/record';
import * as OpenAIOptions from '../utils/openai-options';
import { ToolSchemaProjection } from '../utils/tool-schema';
import {
  options,
  serviceTier,
  OpenAIResponsesInputItem,
  type OpenAIResponsesReasoningInput,
  type OpenAIResponsesReasoningReplay,
  type OpenAIResponsesFunctionTool,
  type OpenAIResponsesTool,
} from '../openai-responses';

const invalid = ProviderShared.invalidRequest;

const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema): OpenAIResponsesFunctionTool => ({
  type: 'function',
  name: tool.vendorWire?.name ?? tool.name,
  description: tool.description,
  parameters: inputSchema,
  strict: false,
});

const lowerTools = (request: LLMRequest): OpenAIResponsesTool[] => {
  const compatibility = request.model.compatibility?.toolSchema;
  const lowered: OpenAIResponsesTool[] = [];
  const namespaces = new Map<string, OpenAIResponsesFunctionTool[]>();
  for (const tool of request.tools) {
    const declared = lowerTool(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, compatibility));
    const namespace = tool.vendorWire?.namespace;
    if (namespace === undefined) {
      lowered.push(declared);
      continue;
    }
    const members = namespaces.get(namespace.name);
    if (members !== undefined) {
      members.push(declared);
      continue;
    }
    const opened = [declared];
    namespaces.set(namespace.name, opened);
    lowered.push({ type: 'namespace', name: namespace.name, description: namespace.description, tools: opened });
  }
  return lowered;
};

const lowerToolChoice = Effect.fnUntraced(function* (
  toolChoice: NonNullable<LLMRequest['toolChoice']>,
  wires: ReadonlyMap<string, VendorWire>,
) {
  const choice = yield* ProviderShared.matchToolChoice('OpenAI Responses', toolChoice, {
    auto: () => 'auto' as const,
    none: () => 'none' as const,
    required: () => 'required' as const,
    tool: (name) => ({ type: 'function' as const, name }),
  });
  if (typeof choice === 'string') return choice;
  const wire = wires.get(choice.name);
  if (wire === undefined) return choice;
  if (wire.namespace !== undefined) {
    return yield* ProviderShared.invalidRequest(
      `OpenAI Responses cannot require ${choice.name} by name: it is declared as ${wire.namespace.name}.${wire.name}, and a named tool choice reaches no namespaced function.`,
    );
  }
  return { type: 'function' as const, name: wire.name };
});

const lowerToolCall = (part: ToolCallPart, wires: ReadonlyMap<string, VendorWire>): OpenAIResponsesInputItem => {
  const wire = wires.get(part.name);
  return {
    type: 'function_call',
    call_id: part.id,
    name: wire?.name ?? part.name,
    namespace: wire?.namespace?.name,
    arguments: ProviderShared.encodeJson(part.input),
  };
};

const lowerReasoning = (part: ReasoningPart): OpenAIResponsesReasoningInput | undefined => {
  const openai = part.providerMetadata?.openai;
  if (!isRecord(openai) || typeof openai.itemId !== 'string' || openai.itemId.length === 0) return undefined;
  const encryptedContent =
    typeof openai.reasoningEncryptedContent === 'string'
      ? openai.reasoningEncryptedContent
      : openai.reasoningEncryptedContent === null
        ? null
        : undefined;
  return {
    type: 'reasoning',
    id: openai.itemId,
    summary: part.text.length > 0 ? [{ type: 'summary_text', text: part.text }] : [],
    encrypted_content: encryptedContent,
  };
};

const hostedToolItemID = (part: ToolResultPart) => {
  const openai = part.providerMetadata?.openai;
  return isRecord(openai) && typeof openai.itemId === 'string' && openai.itemId.length > 0 ? openai.itemId : undefined;
};

const lowerUserContent = Effect.fn('OpenAIResponses.lowerUserContent')(function* (part: LLMRequest['messages'][number]['content'][number]) {
  if (part.type === 'text') return { type: 'input_text' as const, text: part.text };
  if (part.type === 'media') {
    const media = yield* ProviderShared.validateMedia('OpenAI Responses', part, new Set<string>(ProviderShared.IMAGE_MIMES));
    return { type: 'input_image' as const, image_url: media.dataUrl };
  }
  return yield* ProviderShared.unsupportedContent('OpenAI Responses', 'user', ['text', 'media']);
});

const lowerToolResultContentItem = Effect.fn('OpenAIResponses.lowerToolResultContentItem')(function* (item: ToolContent) {
  if (item.type === 'text') return { type: 'input_text' as const, text: item.text };
  const media = yield* ProviderShared.validateToolFile('OpenAI Responses', item, new Set<string>(ProviderShared.IMAGE_MIMES));
  return { type: 'input_image' as const, image_url: media.dataUrl };
});

const lowerToolResultOutput = Effect.fn('OpenAIResponses.lowerToolResultOutput')(function* (part: ToolResultPart) {
  if (part.result.type !== 'content') return ProviderShared.toolResultText(part);
  const content: ReadonlyArray<ToolContent> = part.result.value;
  return yield* Effect.forEach(content, lowerToolResultContentItem);
});

const lowerMessages = Effect.fn('OpenAIResponses.lowerMessages')(function* (request: LLMRequest, wires: ReadonlyMap<string, VendorWire>) {
  const system: OpenAIResponsesInputItem[] =
    request.system.length === 0 ? [] : [{ role: 'system', content: ProviderShared.joinText(request.system) }];
  const input: OpenAIResponsesInputItem[] = [...system];
  const store = OpenAIOptions.store(request);

  for (const message of request.messages) {
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('OpenAI Responses', message);
      const previous = input.at(-1);
      if (previous && 'role' in previous && previous.role === 'user')
        input[input.length - 1] = {
          role: 'user',
          content: [...previous.content, { type: 'input_text', text: part.text }],
        };
      else input.push({ role: 'user', content: [{ type: 'input_text', text: part.text }] });
      continue;
    }

    if (message.role === 'user') {
      input.push({ role: 'user', content: yield* Effect.forEach(message.content, lowerUserContent) });
      continue;
    }

    if (message.role === 'assistant') {
      const content: TextPart[] = [];
      const reasoningItems: Record<string, OpenAIResponsesReasoningReplay> = {};
      const reasoningReferences = new Set<string>();
      const hostedToolReferences = new Set<string>();
      const flushText = () => {
        if (content.length === 0) return;
        input.push({ role: 'assistant', content: content.map((part) => ({ type: 'output_text', text: part.text })) });
        content.splice(0, content.length);
      };
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push(part);
          continue;
        }
        if (part.type === 'reasoning') {
          flushText();
          const reasoning = lowerReasoning(part);
          if (!reasoning) continue;
          if (store !== false) {
            if (!reasoningReferences.has(reasoning.id)) input.push({ type: 'item_reference', id: reasoning.id });
            reasoningReferences.add(reasoning.id);
            continue;
          }
          const existing = reasoningItems[reasoning.id];
          if (existing) {
            existing.summary.push(...reasoning.summary);
            if (typeof reasoning.encrypted_content === 'string') existing.encrypted_content = reasoning.encrypted_content;
            continue;
          }
          const replay = {
            type: reasoning.type,
            summary: reasoning.summary,
            encrypted_content: reasoning.encrypted_content,
          };
          reasoningItems[reasoning.id] = replay;
          input.push(replay);
          continue;
        }
        if (part.type === 'tool-call') {
          flushText();
          if (part.providerExecuted === true) continue;
          input.push(lowerToolCall(part, wires));
          continue;
        }
        if (part.type === 'tool-result' && part.providerExecuted === true) {
          flushText();
          const itemID = hostedToolItemID(part);
          if (store !== false && itemID && !hostedToolReferences.has(itemID)) input.push({ type: 'item_reference', id: itemID });
          if (itemID) hostedToolReferences.add(itemID);
          continue;
        }
        return yield* ProviderShared.unsupportedContent('OpenAI Responses', 'assistant', ['text', 'reasoning', 'tool-call', 'tool-result']);
      }
      flushText();
      continue;
    }

    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('OpenAI Responses', 'tool', ['tool-result']);
      input.push({
        type: 'function_call_output',
        call_id: part.id,
        output: yield* lowerToolResultOutput(part),
      });
    }
  }

  return store === false
    ? input.filter((item) => !('type' in item) || item.type !== 'reasoning' || typeof item.encrypted_content === 'string')
    : input;
});

const lowerOptions = Effect.fn('OpenAIResponses.lowerOptions')(function* (request: LLMRequest) {
  const store = OpenAIOptions.store(request);
  const parallelToolCalls = OpenAIOptions.parallelToolCalls(request);
  const promptCacheKey = OpenAIOptions.promptCacheKey(request);
  const effort = OpenAIOptions.reasoningEffort(request);
  const summary = OpenAIOptions.reasoningSummary(request);
  const include = OpenAIOptions.include(request);
  const verbosity = OpenAIOptions.textVerbosity(request);
  const instructions = OpenAIOptions.instructions(request);
  const serviceTier = OpenAIOptions.serviceTier(request);
  return {
    instructions: instructions || undefined,
    store,
    parallel_tool_calls: parallelToolCalls,
    prompt_cache_key: promptCacheKey || undefined,
    include,
    reasoning: effort || summary ? { effort, summary } : undefined,
    text: verbosity ? { verbosity } : undefined,
    service_tier: serviceTier,
  };
});

export const fromRequest = Effect.fn('OpenAIResponses.fromRequest')(function* (request: LLMRequest) {
  const generation = request.generation;
  const options = yield* lowerOptions(request);
  const wires = vendorWires(request.tools);
  return {
    model: request.model.id,
    input: yield* lowerMessages(request, wires),
    tools: request.tools.length === 0 ? undefined : lowerTools(request),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice, wires) : undefined,
    stream: true as const,
    max_output_tokens: generation?.maxTokens,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    ...options,
  };
});
