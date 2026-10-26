import { Effect } from 'effect';
import { isContextOverflow } from '../../provider-error';
import type { StreamRefusal, StreamRefusalPolicy } from '../../route/refusal';
import type { FinishReason, ProviderMetadata } from '../../schema/ids';
import { LLMEvent, Usage } from '../../schema/events';
import { type LLMRequest, ToolResultValue } from '../../schema/messages';
import * as ProviderShared from '../shared';
import * as Lifecycle from '../utils/lifecycle';
import * as OpenAIOptions from '../utils/openai-options';
import * as ToolStream from '../utils/tool-stream';
import { catalogNames, wireKey } from './wires';
import { ADAPTER, OpenAIResponsesUsage, OpenAIResponsesStreamItem, OpenAIResponsesEvent } from '../openai-responses';

export interface ParserState {
  readonly tools: ToolStream.State<string>;
  readonly hasFunctionCall: boolean;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningItems: Readonly<Record<string, ReasoningStreamItem>>;
  readonly store: boolean | undefined;
  readonly refusals: StreamRefusalPolicy | undefined;
  readonly names: ReadonlyMap<string, string>;
}

const catalogName = (state: ParserState, item: OpenAIResponsesStreamItem): string => {
  if (item.name === undefined) return '';
  const declared = state.names.get(wireKey(item.name, item.namespace));
  if (declared !== undefined) return declared;
  return item.namespace === undefined ? item.name : `${item.namespace}.${item.name}`;
};

type ReasoningSummaryStatus = 'active' | 'can-conclude' | 'concluded';

interface ReasoningStreamItem {
  readonly encryptedContent: string | null | undefined;
  readonly summaryParts: Readonly<Record<number, ReasoningSummaryStatus>>;
}

const mapUsage = (usage: OpenAIResponsesUsage | null | undefined) => {
  if (!usage) return undefined;
  const cached = usage.input_tokens_details?.cached_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  const nonCached = ProviderShared.subtractTokens(usage.input_tokens, cached);
  return new Usage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(usage.input_tokens, usage.output_tokens, usage.total_tokens),
    providerMetadata: { openai: usage },
  });
};

const mapFinishReason = (event: OpenAIResponsesEvent, hasFunctionCall: boolean): FinishReason => {
  const reason = event.response?.incomplete_details?.reason;
  if (reason === undefined || reason === null) return hasFunctionCall ? 'tool-calls' : 'stop';
  if (reason === 'max_output_tokens') return 'length';
  if (reason === 'content_filter') return 'content-filter';
  return hasFunctionCall ? 'tool-calls' : 'unknown';
};

const openaiMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({ openai: metadata });

const HOSTED_TOOLS = {
  web_search_call: { name: 'web_search', input: (item) => item.action ?? {} },
  web_search_preview_call: { name: 'web_search_preview', input: (item) => item.action ?? {} },
  file_search_call: { name: 'file_search', input: (item) => ({ queries: item.queries ?? [] }) },
  code_interpreter_call: {
    name: 'code_interpreter',
    input: (item) => ({ code: item.code, container_id: item.container_id }),
  },
  computer_use_call: { name: 'computer_use', input: (item) => item.action ?? {} },
  image_generation_call: { name: 'image_generation', input: () => ({}) },
  mcp_call: {
    name: 'mcp',
    input: (item) => ({ server_label: item.server_label, name: item.name, arguments: item.arguments }),
  },
  local_shell_call: { name: 'local_shell', input: (item) => item.action ?? {} },
} as const satisfies Record<string, { readonly name: string; readonly input: (item: OpenAIResponsesStreamItem) => unknown }>;

type HostedToolType = keyof typeof HOSTED_TOOLS;

const isHostedToolItem = (item: OpenAIResponsesStreamItem): item is OpenAIResponsesStreamItem & { type: HostedToolType; id: string } =>
  item.type in HOSTED_TOOLS && typeof item.id === 'string' && item.id.length > 0;

const isReasoningItem = (item: OpenAIResponsesStreamItem): item is OpenAIResponsesStreamItem & { type: 'reasoning'; id: string } =>
  item.type === 'reasoning' && typeof item.id === 'string' && item.id.length > 0;

const hostedToolResult = (item: OpenAIResponsesStreamItem) => {
  const isError = typeof item.error !== 'undefined' && item.error !== null;
  return isError ? ToolResultValue.from(item.error, 'error') : ToolResultValue.from(item);
};

const hostedToolEvents = (item: OpenAIResponsesStreamItem & { type: HostedToolType; id: string }): ReadonlyArray<LLMEvent> => {
  const tool = HOSTED_TOOLS[item.type];
  const providerMetadata = openaiMetadata({ itemId: item.id });
  return [
    LLMEvent.toolCall({
      id: item.id,
      name: tool.name,
      input: tool.input(item),
      providerExecuted: true,
      providerMetadata,
    }),
    LLMEvent.toolResult({
      id: item.id,
      name: tool.name,
      result: hostedToolResult(item),
      providerExecuted: true,
      providerMetadata,
    }),
  ];
};

type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>];

const NO_EVENTS: StepResult['1'] = [];

export const TERMINAL_TYPES = new Set(['response.done', 'response.completed', 'response.incomplete', 'response.failed']);

const onOutputTextDelta = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  if (!event.delta) return [state, NO_EVENTS];
  const events: LLMEvent[] = [];
  return [{ ...state, lifecycle: Lifecycle.textDelta(state.lifecycle, events, event.item_id ?? 'text-0', event.delta) }, events];
};

const onReasoningDelta = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  if (!event.delta) return [state, NO_EVENTS];
  const events: LLMEvent[] = [];
  const itemID = event.item_id ?? 'reasoning-0';
  const id = event.summary_index !== undefined || state.reasoningItems[itemID] ? `${itemID}:${event.summary_index ?? 0}` : itemID;
  return [
    {
      ...state,
      lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, id, event.delta),
    },
    events,
  ];
};

const onReasoningDone = (state: ParserState, _event: OpenAIResponsesEvent): StepResult => [state, NO_EVENTS];

const reasoningMetadata = (item: OpenAIResponsesStreamItem & { id: string }) =>
  openaiMetadata({ itemId: item.id, reasoningEncryptedContent: item.encrypted_content ?? null });

const onOutputItemAdded = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  const item = event.item;
  if (item && isReasoningItem(item)) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningStart(state.lifecycle, events, `${item.id}:0`, reasoningMetadata(item)),
        reasoningItems: {
          ...state.reasoningItems,
          [item.id]: { encryptedContent: item.encrypted_content, summaryParts: { 0: 'active' } },
        },
      },
      events,
    ];
  }
  if (item?.type !== 'function_call' || !item.id) return [state, NO_EVENTS];
  const providerMetadata = openaiMetadata({ itemId: item.id });
  const events: LLMEvent[] = [];
  const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
  const name = catalogName(state, item);
  return [
    {
      ...state,
      lifecycle,
      hasFunctionCall: state.hasFunctionCall,
      tools: ToolStream.start(state.tools, item.id, {
        id: item.call_id ?? item.id,
        name,
        input: item.arguments ?? '',
        providerMetadata,
      }),
    },
    [...events, LLMEvent.toolInputStart({ id: item.call_id ?? item.id, name, providerMetadata })],
  ];
};

const onReasoningSummaryPartAdded = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  if (!event.item_id || event.summary_index === undefined) return [state, NO_EVENTS];
  const item = state.reasoningItems[event.item_id] ?? { encryptedContent: undefined, summaryParts: {} };
  if (event.summary_index === 0) {
    if (state.reasoningItems[event.item_id]) return [state, NO_EVENTS];
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningStart(
          state.lifecycle,
          events,
          `${event.item_id}:0`,
          openaiMetadata({ itemId: event.item_id, reasoningEncryptedContent: null }),
        ),
        reasoningItems: {
          ...state.reasoningItems,
          [event.item_id]: { ...item, summaryParts: { 0: 'active' } },
        },
      },
      events,
    ];
  }

  const events: LLMEvent[] = [];
  const closed = Object.entries(item.summaryParts)
    .filter((entry) => entry[1] === 'can-conclude')
    .reduce(
      (lifecycle, entry) =>
        Lifecycle.reasoningEnd(lifecycle, events, `${event.item_id}:${entry[0]}`, openaiMetadata({ itemId: event.item_id })),
      state.lifecycle,
    );
  return [
    {
      ...state,
      lifecycle: Lifecycle.reasoningStart(
        closed,
        events,
        `${event.item_id}:${event.summary_index}`,
        openaiMetadata({ itemId: event.item_id, reasoningEncryptedContent: item.encryptedContent ?? null }),
      ),
      reasoningItems: {
        ...state.reasoningItems,
        [event.item_id]: {
          ...item,
          summaryParts: {
            ...Object.fromEntries(
              Object.entries(item.summaryParts).map((entry) => (entry[1] === 'can-conclude' ? [entry[0], 'concluded' as const] : entry)),
            ),
            [event.summary_index]: 'active',
          },
        },
      },
    },
    events,
  ];
};

const onReasoningSummaryPartDone = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  if (!event.item_id || event.summary_index === undefined) return [state, NO_EVENTS];
  const item = state.reasoningItems[event.item_id];
  if (!item) return [state, NO_EVENTS];
  const events: LLMEvent[] = [];
  return [
    {
      ...state,
      lifecycle:
        state.store !== false
          ? Lifecycle.reasoningEnd(
              state.lifecycle,
              events,
              `${event.item_id}:${event.summary_index}`,
              openaiMetadata({ itemId: event.item_id }),
            )
          : state.lifecycle,
      reasoningItems: {
        ...state.reasoningItems,
        [event.item_id]: {
          ...item,
          summaryParts: {
            ...item.summaryParts,
            [event.summary_index]: state.store !== false ? 'concluded' : 'can-conclude',
          },
        },
      },
    },
    events,
  ];
};

const onFunctionCallArgumentsDelta = Effect.fnUntraced(function* (state: ParserState, event: OpenAIResponsesEvent) {
  if (!event.item_id || !event.delta) return [state, NO_EVENTS] satisfies StepResult;
  const result = ToolStream.appendExisting(
    ADAPTER,
    state.tools,
    event.item_id,
    event.delta,
    'OpenAI Responses tool argument delta is missing its tool call',
  );
  if (ToolStream.isError(result)) return yield* result;
  const events: LLMEvent[] = [];
  const lifecycle = result.events.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle;
  events.push(...result.events);
  return [{ ...state, lifecycle, tools: result.tools }, events] satisfies StepResult;
});

const onOutputItemDone = Effect.fnUntraced(function* (state: ParserState, event: OpenAIResponsesEvent) {
  const item = event.item;
  if (!item) return [state, NO_EVENTS] satisfies StepResult;

  if (item.type === 'function_call') {
    if (!item.id || !item.call_id || !item.name) return [state, NO_EVENTS] satisfies StepResult;
    const tools = state.tools[item.id]
      ? state.tools
      : ToolStream.start(state.tools, item.id, { id: item.call_id, name: catalogName(state, item) });
    const result =
      item.arguments === undefined ? ToolStream.finish(tools, item.id) : ToolStream.finishWithInput(tools, item.id, item.arguments);
    const events: LLMEvent[] = [];
    const resultEvents = result.events ?? [];
    const lifecycle = resultEvents.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle;
    events.push(...resultEvents);
    return [
      {
        ...state,
        lifecycle,
        hasFunctionCall: resultEvents.some(LLMEvent.is.toolCall) ? true : state.hasFunctionCall,
        tools: result.tools,
      },
      events,
    ] satisfies StepResult;
  }

  if (isHostedToolItem(item)) {
    const events: LLMEvent[] = [];
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
    events.push(...hostedToolEvents(item));
    return [{ ...state, lifecycle }, events] satisfies StepResult;
  }

  if (isReasoningItem(item)) {
    const events: LLMEvent[] = [];
    const providerMetadata = reasoningMetadata(item);
    const reasoningItem = state.reasoningItems[item.id];
    if (reasoningItem) {
      const lifecycle = Object.entries(reasoningItem.summaryParts)
        .filter((entry) => entry[1] === 'active' || entry[1] === 'can-conclude')
        .reduce(
          (lifecycle, entry) => Lifecycle.reasoningEnd(lifecycle, events, `${item.id}:${entry[0]}`, providerMetadata),
          state.lifecycle,
        );
      const { [item.id]: _removed, ...reasoningItems } = state.reasoningItems;
      return [{ ...state, lifecycle, reasoningItems }, events] satisfies StepResult;
    }
    if (!state.lifecycle.reasoning.has(item.id)) {
      const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
      events.push(LLMEvent.reasoningStart({ id: item.id, providerMetadata }));
      events.push(LLMEvent.reasoningEnd({ id: item.id, providerMetadata }));
      return [{ ...state, lifecycle }, events] satisfies StepResult;
    }
    return [
      { ...state, lifecycle: Lifecycle.reasoningEnd(state.lifecycle, events, item.id, providerMetadata) },
      events,
    ] satisfies StepResult;
  }

  return [state, NO_EVENTS] satisfies StepResult;
});

const onResponseFinish = (state: ParserState, event: OpenAIResponsesEvent): StepResult => {
  const events: LLMEvent[] = [];
  const lifecycle = Lifecycle.finish(state.lifecycle, events, {
    reason: mapFinishReason(event, state.hasFunctionCall),
    usage: mapUsage(event.response?.usage),
    providerMetadata:
      event.response?.id || event.response?.service_tier
        ? openaiMetadata({
            responseId: event.response.id,
            serviceTier: event.response.service_tier,
          })
        : undefined,
  });
  return [{ ...state, lifecycle }, events];
};

const providerRefusal = (event: OpenAIResponsesEvent): StreamRefusal => {
  const nested = event.error ?? event.response?.error;
  return {
    code: event.code?.trim() || nested?.code?.trim() || nested?.type?.trim() || undefined,
    message: event.message?.trim() || nested?.message?.trim() || '',
  };
};

const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'rate_limit_exceeded',
  'server_error',
  'server_is_overloaded',
  'slow_down',
  'vector_store_timeout',
]);

const providerRetryable = (state: ParserState, refusal: StreamRefusal): boolean => {
  if (refusal.code !== undefined && TRANSIENT_CODES.has(refusal.code)) return true;
  return state.refusals?.(refusal)?.retryable ?? false;
};

const providerModelStarted = (state: ParserState, event: OpenAIResponsesEvent): boolean | undefined =>
  state.lifecycle.stepStarted ? true : event.sequence_number === 0 ? false : undefined;

const providerFailure = (state: ParserState, event: OpenAIResponsesEvent) => {
  const refusal = providerRefusal(event);
  const payloadKeys = Object.keys(event.error ?? event.response?.error ?? {});
  return ProviderShared.providerStreamFailure({
    module: 'OpenAIResponses',
    refusal,
    evidence: {
      eventType: event.type,
      keys: Object.keys(event),
      payloadKeys,
    },
    unrecognized: payloadKeys.some((key) => !['code', 'type', 'message', 'param'].includes(key)),
    contextOverflow: refusal.code === 'context_length_exceeded' || isContextOverflow(refusal.message),
    retryable: providerRetryable(state, refusal),
    modelStarted: providerModelStarted(state, event),
  });
};

export const step = (state: ParserState, event: OpenAIResponsesEvent) => {
  if (event.type === 'response.output_text.delta') return Effect.succeed(onOutputTextDelta(state, event));
  if (
    event.type === 'response.reasoning_text.delta' ||
    event.type === 'response.reasoning_summary.delta' ||
    event.type === 'response.reasoning_summary_text.delta'
  )
    return Effect.succeed(onReasoningDelta(state, event));
  if (
    event.type === 'response.reasoning_text.done' ||
    event.type === 'response.reasoning_summary.done' ||
    event.type === 'response.reasoning_summary_text.done'
  )
    return Effect.succeed(onReasoningDone(state, event));
  if (event.type === 'response.reasoning_summary_part.added') return Effect.succeed(onReasoningSummaryPartAdded(state, event));
  if (event.type === 'response.reasoning_summary_part.done') return Effect.succeed(onReasoningSummaryPartDone(state, event));
  if (event.type === 'response.output_item.added') return Effect.succeed(onOutputItemAdded(state, event));
  if (event.type === 'response.function_call_arguments.delta') return onFunctionCallArgumentsDelta(state, event);
  if (event.type === 'response.output_item.done') return onOutputItemDone(state, event);
  if (event.type === 'response.done' || event.type === 'response.completed' || event.type === 'response.incomplete')
    return Effect.succeed(onResponseFinish(state, event));
  if (event.type === 'response.failed' || event.type === 'error') return Effect.fail(providerFailure(state, event));
  return Effect.succeed<StepResult>([state, NO_EVENTS]);
};

export const initialState = (request: LLMRequest): ParserState => ({
  hasFunctionCall: false,
  tools: ToolStream.empty<string>(),
  lifecycle: Lifecycle.initial(),
  reasoningItems: {},
  store: OpenAIOptions.store(request),
  refusals: request.model.route.refusals,
  names: catalogNames(request.tools),
});
