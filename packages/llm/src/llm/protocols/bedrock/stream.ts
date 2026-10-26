import { Effect } from 'effect';
import { isContextOverflow } from '../../provider-error';
import type { StreamRefusal } from '../../route/refusal';
import type { FinishReason } from '../../schema/ids';
import { LLMEvent, Usage } from '../../schema/events';
import * as ProviderShared from '../shared';
import * as Lifecycle from '../utils/lifecycle';
import * as ToolStream from '../utils/tool-stream';
import { ADAPTER, BedrockUsageSchema, BedrockEvent, bedrockMetadata } from '../bedrock-converse';

const mapFinishReason = (reason: string): FinishReason => {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool-calls';
  if (reason === 'content_filtered' || reason === 'guardrail_intervened') return 'content-filter';
  return 'unknown';
};

const mapUsage = (usage: BedrockUsageSchema | undefined): Usage | undefined => {
  if (!usage) return undefined;
  const cacheTotal = (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0);
  const nonCached = ProviderShared.subtractTokens(usage.inputTokens, cacheTotal);
  return new Usage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(usage.inputTokens, usage.outputTokens, usage.totalTokens),
    providerMetadata: { bedrock: usage },
  });
};

interface ParserState {
  readonly tools: ToolStream.State<number>;
  readonly pendingFinish: { readonly reason: FinishReason; readonly usage?: Usage } | undefined;
  readonly hasToolCalls: boolean;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningSignatures: Readonly<Record<number, string>>;
}

export const step = Effect.fnUntraced(function* (state: ParserState, event: BedrockEvent) {
  if (event.contentBlockStart?.start?.toolUse) {
    const index = event.contentBlockStart.contentBlockIndex;
    const events: LLMEvent[] = [];
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
    return [
      {
        ...state,
        lifecycle,
        tools: ToolStream.start(state.tools, index, {
          id: event.contentBlockStart.start.toolUse.toolUseId,
          name: event.contentBlockStart.start.toolUse.name,
        }),
      },
      [
        ...events,
        LLMEvent.toolInputStart({
          id: event.contentBlockStart.start.toolUse.toolUseId,
          name: event.contentBlockStart.start.toolUse.name,
        }),
      ],
    ] as const;
  }

  if (event.contentBlockDelta?.delta?.text) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.textDelta(
          state.lifecycle,
          events,
          `text-${event.contentBlockDelta.contentBlockIndex}`,
          event.contentBlockDelta.delta.text,
        ),
      },
      events,
    ] as const;
  }

  if (event.contentBlockDelta?.delta?.reasoningContent) {
    const index = event.contentBlockDelta.contentBlockIndex;
    const reasoning = event.contentBlockDelta.delta.reasoningContent;
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: reasoning.text
          ? Lifecycle.reasoningDelta(state.lifecycle, events, `reasoning-${index}`, reasoning.text)
          : state.lifecycle,
        reasoningSignatures: reasoning.signature
          ? { ...state.reasoningSignatures, [index]: reasoning.signature }
          : state.reasoningSignatures,
      },
      events,
    ] as const;
  }

  if (event.contentBlockDelta?.delta?.toolUse) {
    const index = event.contentBlockDelta.contentBlockIndex;
    const result = ToolStream.appendExisting(
      ADAPTER,
      state.tools,
      index,
      event.contentBlockDelta.delta.toolUse.input,
      'Bedrock Converse tool delta is missing its tool call',
    );
    if (ToolStream.isError(result)) return yield* result;
    const events: LLMEvent[] = [];
    const lifecycle = result.events.length ? Lifecycle.stepStart(state.lifecycle, events) : state.lifecycle;
    events.push(...result.events);
    return [{ ...state, lifecycle, tools: result.tools }, events] as const;
  }

  if (event.contentBlockStop) {
    const index = event.contentBlockStop.contentBlockIndex;
    const result = ToolStream.finish(state.tools, index);
    const events: LLMEvent[] = [];
    const resultEvents = result.events ?? [];
    const lifecycle = resultEvents.length
      ? Lifecycle.stepStart(state.lifecycle, events)
      : Lifecycle.reasoningEnd(
          Lifecycle.textEnd(state.lifecycle, events, `text-${index}`),
          events,
          `reasoning-${index}`,
          state.reasoningSignatures[index] ? bedrockMetadata({ signature: state.reasoningSignatures[index] }) : undefined,
        );
    events.push(...resultEvents);
    return [
      {
        ...state,
        hasToolCalls: resultEvents.some(LLMEvent.is.toolCall) ? true : state.hasToolCalls,
        lifecycle,
        tools: result.tools,
        reasoningSignatures: Object.fromEntries(Object.entries(state.reasoningSignatures).filter(([key]) => key !== String(index))),
      },
      events,
    ] as const;
  }

  if (event.messageStop) {
    return [
      {
        ...state,
        pendingFinish: { reason: mapFinishReason(event.messageStop.stopReason), usage: state.pendingFinish?.usage },
      },
      [],
    ] as const;
  }

  if (event.metadata) {
    const usage = mapUsage(event.metadata.usage);
    return [{ ...state, pendingFinish: { reason: state.pendingFinish?.reason ?? 'stop', usage } }, []] as const;
  }

  const transient = converseException(event, TRANSIENT_EXCEPTIONS);
  if (transient) {
    return yield* ProviderShared.providerStreamFailure({
      module: 'BedrockConverse',
      refusal: transient,
      evidence: { eventType: transient.code, keys: Object.keys(event) },
      retryable: true,
    });
  }

  const refused = converseException(event, REFUSING_EXCEPTIONS);
  if (refused) {
    return yield* ProviderShared.providerStreamFailure({
      module: 'BedrockConverse',
      refusal: refused,
      evidence: { eventType: refused.code, keys: Object.keys(event) },
      contextOverflow: refused.code === 'validationException' && isContextOverflow(refused.message),
      retryable: refused.code === 'throttlingException',
    });
  }

  return [state, []] as const;
});

const TRANSIENT_EXCEPTIONS = ['internalServerException', 'modelStreamErrorException', 'serviceUnavailableException'] as const;
const REFUSING_EXCEPTIONS = ['validationException', 'throttlingException'] as const;

const converseException = (
  event: BedrockEvent,
  keys: ReadonlyArray<(typeof TRANSIENT_EXCEPTIONS)[number] | (typeof REFUSING_EXCEPTIONS)[number]>,
): StreamRefusal | undefined => {
  for (const key of keys) {
    const exception = event[key];
    if (exception) return { code: key, message: exception.message };
  }
  return undefined;
};

export const onHalt = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.pendingFinish
    ? (() => {
        const events: LLMEvent[] = [];
        Lifecycle.finish(state.lifecycle, events, {
          reason: state.pendingFinish.reason === 'stop' && state.hasToolCalls ? 'tool-calls' : state.pendingFinish.reason,
          usage: state.pendingFinish.usage,
        });
        return events;
      })()
    : [];

export const initialState = (): ParserState => ({
  tools: ToolStream.empty<number>(),
  pendingFinish: undefined,
  hasToolCalls: false,
  lifecycle: Lifecycle.initial(),
  reasoningSignatures: {},
});
