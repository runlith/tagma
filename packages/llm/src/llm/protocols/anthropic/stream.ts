import { Effect } from 'effect';
import { isContextOverflow } from '../../provider-error';
import { ModelIdentity } from '../../schema/options';
import type { FinishReason } from '../../schema/ids';
import { InputUsage, LLMEvent, Usage } from '../../schema/events';
import { type LLMRequest, ToolResultValue } from '../../schema/messages';
import * as ProviderShared from '../shared';
import * as Lifecycle from '../utils/lifecycle';
import * as ToolStream from '../utils/tool-stream';
import { ADAPTER, AnthropicServerToolResultType, AnthropicUsage, AnthropicEvent, anthropicMetadata } from '../anthropic-messages';

export interface ParserState {
  readonly tools: ToolStream.State<number>;
  readonly usage?: Usage;
  readonly lifecycle: Lifecycle.State;
  readonly messageId?: string;
  readonly provider: ModelIdentity['provider'];
}

const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'pause_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool-calls';
  if (reason === 'refusal') return 'content-filter';
  return 'unknown';
};

const EXECUTOR_ITERATION = 'message';

const executorUsage = (usage: AnthropicUsage): AnthropicUsage => {
  const iterations = usage.iterations ?? [];
  if (iterations.length < 2) return usage;
  const executor = iterations.findLast((iteration) => iteration.type === EXECUTOR_ITERATION || iteration.type === 'fallback_message');
  if (executor === undefined) return usage;
  return {
    ...usage,
    input_tokens: executor.input_tokens,
    output_tokens: executor.output_tokens,
    cache_read_input_tokens: executor.cache_read_input_tokens,
    cache_creation_input_tokens: executor.cache_creation_input_tokens,
  };
};

const mapUsage = (usage: AnthropicUsage | undefined): Usage | undefined => {
  if (!usage) return undefined;
  const billed = executorUsage(usage);
  const nonCached = billed.input_tokens;
  const cacheRead = billed.cache_read_input_tokens ?? undefined;
  const cacheWrite = billed.cache_creation_input_tokens ?? undefined;
  const inputTokens = ProviderShared.sumTokens(nonCached, cacheRead, cacheWrite);
  const reasoningTokens = usage.output_tokens_details?.thinking_tokens;
  return new Usage({
    inputTokens,
    outputTokens: billed.output_tokens,
    reasoningTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    totalTokens: ProviderShared.totalTokens(inputTokens, billed.output_tokens, undefined),
    providerMetadata: { anthropic: usage },
  });
};

const mapInputUsage = (usage: Usage): InputUsage | undefined =>
  usage.inputTokens === undefined
    ? undefined
    : new InputUsage({
        inputTokens: usage.inputTokens,
        nonCachedInputTokens: usage.nonCachedInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
        providerMetadata: usage.providerMetadata,
      });

const mergeUsage = (left: Usage | undefined, right: Usage | undefined) => {
  if (!left) return right;
  if (!right) return left;
  const nonCachedInputTokens = right.nonCachedInputTokens ?? left.nonCachedInputTokens;
  const cacheReadInputTokens = right.cacheReadInputTokens ?? left.cacheReadInputTokens;
  const cacheWriteInputTokens = right.cacheWriteInputTokens ?? left.cacheWriteInputTokens;
  const inputTokens = ProviderShared.sumTokens(nonCachedInputTokens, cacheReadInputTokens, cacheWriteInputTokens);
  const outputTokens = right.outputTokens ?? left.outputTokens;
  const reasoningTokens = right.reasoningTokens ?? left.reasoningTokens;
  return new Usage({
    inputTokens,
    outputTokens,
    reasoningTokens,
    nonCachedInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(inputTokens, outputTokens, undefined),
    providerMetadata: {
      anthropic: {
        ...left.providerMetadata?.['anthropic'],
        ...right.providerMetadata?.['anthropic'],
      },
    },
  });
};

const SERVER_TOOL_RESULT_NAMES: Record<AnthropicServerToolResultType, string> = {
  web_search_tool_result: 'web_search',
  code_execution_tool_result: 'code_execution',
  web_fetch_tool_result: 'web_fetch',
};

const isServerToolResultType = (type: string): type is AnthropicServerToolResultType => type in SERVER_TOOL_RESULT_NAMES;

const serverToolResultEvent = (block: NonNullable<AnthropicEvent['content_block']>): LLMEvent | undefined => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined;
  const errorPayload =
    typeof block.content === 'object' && block.content !== null && 'type' in block.content
      ? String((block.content as Record<string, unknown>).type)
      : '';
  const isError = errorPayload.endsWith('_tool_result_error');
  return LLMEvent.toolResult({
    id: block.tool_use_id ?? '',
    name: SERVER_TOOL_RESULT_NAMES[block.type],
    result: ToolResultValue.from(block.content, isError ? 'error' : 'json'),
    providerExecuted: true,
    providerMetadata: anthropicMetadata({ blockType: block.type }),
  });
};

type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>];

const NO_EVENTS: StepResult['1'] = [];

const onMessageStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const messageId = typeof event.message?.id === 'string' ? event.message.id : undefined;
  const next = messageId === undefined ? state : { ...state, messageId };
  const usage = mapUsage(event.message?.usage);
  if (!usage) return [next, NO_EVENTS];
  const measured = mapInputUsage(usage);
  return [
    { ...next, usage: mergeUsage(state.usage, usage) },
    measured ? [LLMEvent.inputUsage({ inputUsage: measured, messageId })] : NO_EVENTS,
  ];
};

const onContentBlockStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const block = event.content_block;
  if (!block) return [state, NO_EVENTS];

  if ((block.type === 'tool_use' || block.type === 'server_tool_use') && event.index !== undefined) {
    const events: LLMEvent[] = [];
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
    return [
      {
        ...state,
        lifecycle,
        tools: ToolStream.start(state.tools, event.index, {
          id: block.id ?? String(event.index),
          name: block.name ?? '',
          providerExecuted: block.type === 'server_tool_use',
          providerMetadata: block.caller === undefined ? undefined : anthropicMetadata({ caller: block.caller }),
        }),
      },
      [...events, LLMEvent.toolInputStart({ id: block.id ?? String(event.index), name: block.name ?? '' })],
    ];
  }

  if (block.type === 'fallback' && block.from !== undefined && block.to !== undefined && block.trigger !== undefined) {
    const events: LLMEvent[] = [];
    return [
      { ...state, lifecycle: Lifecycle.stepStart(state.lifecycle, events) },
      [
        ...events,
        LLMEvent.modelFallback({
          from: new ModelIdentity({ provider: state.provider, model: block.from.model as ModelIdentity['model'] }),
          to: new ModelIdentity({ provider: state.provider, model: block.to.model as ModelIdentity['model'] }),
          trigger: block.trigger,
          providerMetadata: anthropicMetadata({ blockType: block.type }),
        }),
      ],
    ];
  }

  if (block.type === 'text' && block.text) {
    const events: LLMEvent[] = [];
    return [{ ...state, lifecycle: Lifecycle.textDelta(state.lifecycle, events, `text-${event.index ?? 0}`, block.text) }, events];
  }

  if (block.type === 'thinking') {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, `reasoning-${event.index ?? 0}`, block.thinking ?? ''),
      },
      events,
    ];
  }

  const result = serverToolResultEvent(block);
  if (!result) return [state, NO_EVENTS];
  const events: LLMEvent[] = [];
  return [{ ...state, lifecycle: Lifecycle.stepStart(state.lifecycle, events) }, [...events, result]];
};

const onContentBlockDelta = Effect.fnUntraced(function* (state: ParserState, event: AnthropicEvent) {
  const delta = event.delta;

  if (delta?.type === 'text_delta' && delta.text) {
    const events: LLMEvent[] = [];
    return [
      { ...state, lifecycle: Lifecycle.textDelta(state.lifecycle, events, `text-${event.index ?? 0}`, delta.text) },
      events,
    ] satisfies StepResult;
  }

  if (delta?.type === 'thinking_delta') {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(state.lifecycle, events, `reasoning-${event.index ?? 0}`, delta.thinking ?? ''),
      },
      events,
    ] satisfies StepResult;
  }

  if (delta?.type === 'signature_delta' && delta.signature) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningEnd(
          state.lifecycle,
          events,
          `reasoning-${event.index ?? 0}`,
          anthropicMetadata({ signature: delta.signature }),
        ),
      },
      events,
    ] satisfies StepResult;
  }

  if (delta?.type === 'input_json_delta' && event.index !== undefined) {
    if (!delta.partial_json) return [state, NO_EVENTS] satisfies StepResult;
    const result = ToolStream.appendExisting(
      ADAPTER,
      state.tools,
      event.index,
      delta.partial_json,
      'Anthropic Messages tool argument delta is missing its tool call',
    );
    if (ToolStream.isError(result)) return yield* result;
    const events: LLMEvent[] = [];
    const lifecycle = result.events.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle;
    events.push(...result.events);
    return [{ ...state, lifecycle, tools: result.tools }, events] satisfies StepResult;
  }

  return [state, NO_EVENTS] satisfies StepResult;
});

const onContentBlockStop = (state: ParserState, event: AnthropicEvent): StepResult => {
  if (event.index === undefined) return [state, NO_EVENTS];
  const result = ToolStream.finish(state.tools, event.index);
  const events: LLMEvent[] = [];
  const resultEvents = result.events ?? [];
  const lifecycle = resultEvents.length
    ? Lifecycle.stepStart(state.lifecycle, events)
    : Lifecycle.reasoningEnd(Lifecycle.textEnd(state.lifecycle, events, `text-${event.index}`), events, `reasoning-${event.index}`);
  events.push(...resultEvents);
  return [{ ...state, lifecycle, tools: result.tools }, events];
};

const onMessageDelta = (state: ParserState, event: AnthropicEvent): StepResult => {
  const usage = mergeUsage(state.usage, mapUsage(event.usage));
  const open = ToolStream.finishAll(state.tools);
  const events: LLMEvent[] = [...open.events];
  const lifecycle = Lifecycle.finish(state.lifecycle, events, {
    reason: mapFinishReason(event.delta?.stop_reason),
    usage,
    providerMetadata: event.delta?.stop_sequence ? anthropicMetadata({ stopSequence: event.delta.stop_sequence }) : undefined,
  });
  return [{ ...state, lifecycle, usage, tools: open.tools }, events];
};

const TRANSIENT_ERRORS = new Set(['api_error', 'overloaded_error', 'rate_limit_error', 'timeout_error']);

const onError = (state: ParserState, event: AnthropicEvent) =>
  ProviderShared.providerStreamFailure({
    module: 'AnthropicMessages',
    refusal: { code: event.error?.type?.trim() || undefined, message: event.error?.message?.trim() ?? '' },
    evidence: { eventType: event.type, keys: Object.keys(event), payloadKeys: Object.keys(event.error ?? {}) },
    unrecognized: Object.keys(event.error ?? {}).some((key) => key !== 'type' && key !== 'message'),
    contextOverflow: isContextOverflow(event.error?.message ?? ''),
    retryable: TRANSIENT_ERRORS.has(event.error?.type?.trim() ?? ''),
    modelStarted: state.lifecycle.stepStarted,
  });

export const step = (state: ParserState, event: AnthropicEvent) => {
  if (event.type === 'message')
    return Effect.gen(function* () {
      if (event.id === undefined || event.content === undefined || event.stop_reason == null)
        return yield* Effect.fail(
          ProviderShared.failureOf(undefined, {
            route: ADAPTER,
            family: 'invalid-output',
            message: 'Anthropic completion is missing its id, content or stop reason',
          }),
        );
      let [next, opened] = onMessageStart(state, { type: 'message_start', message: { id: event.id, usage: event.usage } });
      const events: LLMEvent[] = [...opened];
      for (const [index, block] of event.content.entries()) {
        let emitted: readonly LLMEvent[];
        [next, emitted] = onContentBlockStart(next, { type: 'content_block_start', index, content_block: block });
        events.push(...emitted);
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          [next, emitted] = yield* onContentBlockDelta(next, {
            type: 'content_block_delta',
            index,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
          });
          events.push(...emitted);
        }
        [next, emitted] = onContentBlockStop(next, { type: 'content_block_stop', index });
        events.push(...emitted);
      }
      const [finished, closed] = onMessageDelta(next, {
        type: 'message_delta',
        delta: { stop_reason: event.stop_reason },
        usage: event.usage,
      });
      return [finished, [...events, ...closed]] as const;
    });
  if (event.type === 'message_start') return Effect.succeed(onMessageStart(state, event));
  if (event.type === 'content_block_start') return Effect.succeed(onContentBlockStart(state, event));
  if (event.type === 'content_block_delta') return onContentBlockDelta(state, event);
  if (event.type === 'content_block_stop') return Effect.succeed(onContentBlockStop(state, event));
  if (event.type === 'message_delta') return Effect.succeed(onMessageDelta(state, event));
  if (event.type === 'error') return Effect.fail(onError(state, event));
  return Effect.succeed<StepResult>([state, NO_EVENTS]);
};

export const initialStateFor = (provider: ModelIdentity['provider']): ParserState => ({
  tools: ToolStream.empty<number>(),
  lifecycle: Lifecycle.initial(),
  provider,
});

export const initialState = (request: LLMRequest): ParserState => initialStateFor(request.model.provider);
