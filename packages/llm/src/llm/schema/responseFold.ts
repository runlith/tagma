import type { FinishReason, ProviderMetadata } from './ids';
import { type ContentPart, Message, ToolCallPart, ToolResultPart } from './messages';
import type { ModelIdentity } from './options';
import {
  LLMEvent,
  LLMResponse,
  Usage,
  type TextDelta,
  type TextEnd,
  type ReasoningDelta,
  type ReasoningEnd,
  type ToolInputStart,
  type ToolInputDelta,
  type ToolInputEnd,
  type ToolCall,
  type ToolResult,
  type ModelFallback,
} from './events';

interface ContentAssembly {
  readonly contentIndex: number;
  readonly chunks: string[];
  providerMetadata?: ProviderMetadata;
}

interface ToolInputAssembly {
  name: string;
  chunks: string[];
  providerMetadata?: ProviderMetadata;
}

export interface State {
  readonly events: ReadonlyArray<LLMEvent>;
  readonly message: Message;
  readonly origin?: ModelIdentity;
  readonly messageId?: string;
  readonly requestId?: string;
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
  readonly textParts: Readonly<Record<string, ContentAssembly>>;
  readonly reasoningParts: Readonly<Record<string, ContentAssembly>>;
  readonly toolInputs: Readonly<Record<string, ToolInputAssembly>>;
  readonly arguments: Readonly<Record<string, string>>;
}

interface MutableResponseState {
  readonly events: LLMEvent[];
  readonly message: Message;
  readonly content: ContentPart[];
  origin?: ModelIdentity;
  messageId?: string;
  requestId?: string;
  native?: Readonly<Record<string, unknown>>;
  usage?: Usage;
  finishReason?: FinishReason;
  readonly textParts: Record<string, ContentAssembly>;
  readonly reasoningParts: Record<string, ContentAssembly>;
  readonly toolInputs: Record<string, ToolInputAssembly>;
  readonly arguments: Record<string, string>;
}

const utf8 = new TextEncoder();

const assistantMessage = (
  origin: ModelIdentity | undefined,
  content: ReadonlyArray<ContentPart>,
  messageId?: string,
  requestId?: string,
): Message =>
  Message.make({
    role: 'assistant',
    content: [...content],
    origin,
    id: messageId,
    requestId,
  });

const textContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: 'text', text } : { type: 'text', text, providerMetadata };

const reasoningContent = (text: string, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  providerMetadata === undefined ? { type: 'reasoning', text } : { type: 'reasoning', text, providerMetadata };

const materializeContent = (state: MutableResponseState): ReadonlyArray<ContentPart> => {
  const content = [...state.content];
  for (const part of Object.values(state.textParts)) content[part.contentIndex] = textContent(part.chunks.join(''), part.providerMetadata);
  for (const part of Object.values(state.reasoningParts))
    content[part.contentIndex] = reasoningContent(part.chunks.join(''), part.providerMetadata);
  return content;
};

export const empty = (origin?: ModelIdentity): State => {
  const state: MutableResponseState = {
    events: [],
    content: [],
    get message() {
      const message = assistantMessage(state.origin, materializeContent(state), state.messageId, state.requestId);
      return state.native === undefined ? message : new Message({ ...message, native: state.native });
    },
    origin,
    textParts: {},
    reasoningParts: {},
    toolInputs: {},
    arguments: {},
  };
  return state;
};

const mutableState = (state: State) => state as MutableResponseState;

const appendEvent = (state: State, event: LLMEvent): MutableResponseState => {
  const next = mutableState(state);
  next.events.push(event);
  if (event.type === 'step-finish') {
    next.requestId = event.requestId;
    next.native = event.native;
  }
  if (LLMEvent.is.finish(event)) {
    next.usage = event.usage ?? next.usage;
    next.finishReason = event.reason;
  } else if ('usage' in event && event.usage !== undefined) {
    next.usage = event.usage;
  }
  return next;
};

const appendContent = (state: MutableResponseState, part: ContentPart) => {
  state.content.push(part);
  return state;
};

const ensureText = (state: MutableResponseState, id: string, providerMetadata?: ProviderMetadata) => {
  if (state.textParts[id]) return state;
  const contentIndex = state.content.length;
  appendContent(state, textContent('', providerMetadata));
  state.textParts[id] = { contentIndex, chunks: [], providerMetadata };
  return state;
};

const reduceTextDelta = (state: MutableResponseState, event: TextDelta) => {
  const current = ensureText(state, event.id, event.providerMetadata).textParts[event.id];
  if (!current) return state;
  current.chunks.push(event.text);
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata;
  return state;
};

const reduceTextEnd = (state: MutableResponseState, event: TextEnd) => {
  const current = state.textParts[event.id];
  if (!current) return state;
  const providerMetadata = event.providerMetadata ?? current.providerMetadata;
  state.content[current.contentIndex] = textContent(current.chunks.join(''), providerMetadata);
  delete state.textParts[event.id];
  return state;
};

const ensureReasoning = (state: MutableResponseState, id: string, providerMetadata?: ProviderMetadata) => {
  if (state.reasoningParts[id]) return state;
  const contentIndex = state.content.length;
  appendContent(state, reasoningContent('', providerMetadata));
  state.reasoningParts[id] = { contentIndex, chunks: [], providerMetadata };
  return state;
};

const reduceReasoningDelta = (state: MutableResponseState, event: ReasoningDelta) => {
  const current = ensureReasoning(state, event.id, event.providerMetadata).reasoningParts[event.id];
  if (!current) return state;
  current.chunks.push(event.text);
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata;
  return state;
};

const reduceReasoningEnd = (state: MutableResponseState, event: ReasoningEnd) => {
  const current = state.reasoningParts[event.id];
  if (!current) return state;
  const providerMetadata = event.providerMetadata ?? current.providerMetadata;
  state.content[current.contentIndex] = reasoningContent(current.chunks.join(''), providerMetadata);
  delete state.reasoningParts[event.id];
  return state;
};

const reduceToolInputStart = (state: MutableResponseState, event: ToolInputStart) => {
  state.toolInputs[event.id] = { name: event.name, chunks: [], providerMetadata: event.providerMetadata };
  return state;
};

const reduceToolInputDelta = (state: MutableResponseState, event: ToolInputDelta) => {
  const current = state.toolInputs[event.id] ?? { name: event.name, chunks: [] };
  current.chunks.push(event.text);
  state.toolInputs[event.id] = current;
  return state;
};

const reduceToolInputEnd = (state: MutableResponseState, event: ToolInputEnd) => {
  const current = state.toolInputs[event.id] ?? { name: event.name, chunks: [] };
  current.name = event.name;
  current.providerMetadata = event.providerMetadata ?? current.providerMetadata;
  current.chunks = [current.chunks.join('')];
  state.toolInputs[event.id] = current;
  return state;
};

const toolCallContent = (event: ToolCall): ContentPart =>
  ToolCallPart.from({
    id: event.id,
    name: event.name,
    input: event.input,
    unparsed: event.unparsed,
    providerExecuted: event.providerExecuted,
    providerMetadata: event.providerMetadata,
  });

const toolResultContent = (event: ToolResult): ContentPart =>
  ToolResultPart.from({
    id: event.id,
    name: event.name,
    result: event.result,
    providerExecuted: event.providerExecuted,
    providerMetadata: event.providerMetadata,
  });

const reduceToolCall = (state: MutableResponseState, event: ToolCall) => {
  const streamed = state.toolInputs[event.id]?.chunks.join('') ?? '';
  state.arguments[event.id] = streamed.length > 0 ? streamed : JSON.stringify(event.input ?? {});
  delete state.toolInputs[event.id];
  return appendContent(state, toolCallContent(event));
};

const reduceModelFallback = (state: MutableResponseState, event: ModelFallback) => {
  state.origin = event.to;
  state.content.splice(0);
  for (const key of Object.keys(state.textParts)) delete state.textParts[key];
  for (const key of Object.keys(state.reasoningParts)) delete state.reasoningParts[key];
  for (const key of Object.keys(state.toolInputs)) delete state.toolInputs[key];
  for (const key of Object.keys(state.arguments)) delete state.arguments[key];
  return appendContent(state, {
    type: 'model-fallback',
    from: event.from,
    to: event.to,
    trigger: event.trigger,
    providerMetadata: event.providerMetadata,
  });
};

const reduceInputUsage = (state: MutableResponseState, event: Extract<LLMEvent, { type: 'input-usage' }>): MutableResponseState => {
  if (state.messageId === undefined && event.messageId !== undefined) state.messageId = event.messageId;
  return state;
};

export const reduce = (state: State, event: LLMEvent): State => {
  const next = appendEvent(state, event);
  switch (event.type) {
    case 'step-start':
      if (event.origin !== undefined) next.origin = event.origin;
      return next;
    case 'input-usage':
      return reduceInputUsage(next, event);
    case 'text-delta':
      return reduceTextDelta(next, event);
    case 'text-end':
      return reduceTextEnd(next, event);
    case 'reasoning-start':
      return ensureReasoning(next, event.id, event.providerMetadata);
    case 'reasoning-delta':
      return reduceReasoningDelta(next, event);
    case 'reasoning-end':
      return reduceReasoningEnd(next, event);
    case 'tool-input-start':
      return reduceToolInputStart(next, event);
    case 'tool-input-delta':
      return reduceToolInputDelta(next, event);
    case 'tool-input-end':
      return reduceToolInputEnd(next, event);
    case 'tool-call':
      return reduceToolCall(next, event);
    case 'tool-result':
      return appendContent(next, toolResultContent(event));
    case 'model-fallback':
      return reduceModelFallback(next, event);
    default:
      return next;
  }
};

export const complete = (state: State): LLMResponse | undefined =>
  state.finishReason === undefined
    ? undefined
    : new LLMResponse({
        message: state.message,
        events: [...state.events],
        usage: state.usage,
        finishReason: state.finishReason,
      });

export const answer = (response: LLMResponse): Uint8Array =>
  utf8.encode(JSON.stringify({ message: response.message, finishReason: response.finishReason, usage: response.usage }));

export const fromEvents = (events: ReadonlyArray<LLMEvent>) => complete(events.reduce(reduce, empty()));
