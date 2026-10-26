import { Schema } from 'effect';
import { ContentBlockID, FinishReason, JsonRecord, ProtocolID, ProviderMetadata, RouteID, ToolCallID } from './ids';
import { Message, ToolOutput, ToolResultValue } from './messages';
import { ModelIdentity, ModelSchema } from './options';
import { QuotaObservation } from './quota';

export class Usage extends Schema.Class<Usage>('LLM.Usage')({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  nonCachedInputTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get visibleOutputTokens() {
    return Math.max(0, (this.outputTokens ?? 0) - (this.reasoningTokens ?? 0));
  }

  static from(input: UsageInput) {
    return input instanceof Usage ? input : new Usage(input);
  }
}

export function sumUsage(left: Usage | null | undefined, right: Usage | null | undefined): Usage {
  if (!left) return right ? Usage.from(right) : new Usage({});
  if (!right) return Usage.from(left);
  const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return new Usage({
    inputTokens: add(left.inputTokens, right.inputTokens),
    outputTokens: add(left.outputTokens, right.outputTokens),
    nonCachedInputTokens: add(left.nonCachedInputTokens, right.nonCachedInputTokens),
    cacheReadInputTokens: add(left.cacheReadInputTokens, right.cacheReadInputTokens),
    cacheWriteInputTokens: add(left.cacheWriteInputTokens, right.cacheWriteInputTokens),
    reasoningTokens: add(left.reasoningTokens, right.reasoningTokens),
    totalTokens: add(left.totalTokens, right.totalTokens),
    providerMetadata: right.providerMetadata ?? left.providerMetadata,
  });
}

export type UsageInput = Usage | ConstructorParameters<typeof Usage>[0];

export class InputUsage extends Schema.Class<InputUsage>('LLM.InputUsage')({
  inputTokens: Schema.Number,
  nonCachedInputTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  static from(input: InputUsageInput) {
    return input instanceof InputUsage ? input : new InputUsage(input);
  }
}

export type InputUsageInput = InputUsage | ConstructorParameters<typeof InputUsage>[0];

export const StepStart = Schema.Struct({
  type: Schema.tag('step-start'),
  index: Schema.Number,
  origin: Schema.optional(ModelIdentity),
}).annotate({ identifier: 'LLM.Event.StepStart' });
export type StepStart = Schema.Schema.Type<typeof StepStart>;

export const InputUsageMeasured = Schema.Struct({
  type: Schema.tag('input-usage'),
  inputUsage: InputUsage,
  messageId: Schema.optional(Schema.String),
}).annotate({ identifier: 'LLM.Event.InputUsage' });
export type InputUsageMeasured = Schema.Schema.Type<typeof InputUsageMeasured>;

export const TextStart = Schema.Struct({
  type: Schema.tag('text-start'),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.TextStart' });
export type TextStart = Schema.Schema.Type<typeof TextStart>;

export const TextDelta = Schema.Struct({
  type: Schema.tag('text-delta'),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.TextDelta' });
export type TextDelta = Schema.Schema.Type<typeof TextDelta>;

export const TextEnd = Schema.Struct({
  type: Schema.tag('text-end'),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.TextEnd' });
export type TextEnd = Schema.Schema.Type<typeof TextEnd>;

export const ReasoningStart = Schema.Struct({
  type: Schema.tag('reasoning-start'),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ReasoningStart' });
export type ReasoningStart = Schema.Schema.Type<typeof ReasoningStart>;

export const ReasoningDelta = Schema.Struct({
  type: Schema.tag('reasoning-delta'),
  id: ContentBlockID,
  text: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ReasoningDelta' });
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>;

export const ReasoningEnd = Schema.Struct({
  type: Schema.tag('reasoning-end'),
  id: ContentBlockID,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ReasoningEnd' });
export type ReasoningEnd = Schema.Schema.Type<typeof ReasoningEnd>;

export const ToolInputStart = Schema.Struct({
  type: Schema.tag('tool-input-start'),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ToolInputStart' });
export type ToolInputStart = Schema.Schema.Type<typeof ToolInputStart>;

export const ToolInputDelta = Schema.Struct({
  type: Schema.tag('tool-input-delta'),
  id: ToolCallID,
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: 'LLM.Event.ToolInputDelta' });
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>;

export const ToolInputEnd = Schema.Struct({
  type: Schema.tag('tool-input-end'),
  id: ToolCallID,
  name: Schema.String,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ToolInputEnd' });
export type ToolInputEnd = Schema.Schema.Type<typeof ToolInputEnd>;

export const ToolCall = Schema.Struct({
  type: Schema.tag('tool-call'),
  id: ToolCallID,
  name: Schema.String,
  input: Schema.Unknown,
  unparsed: Schema.optional(Schema.String),
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ToolCall' });
export type ToolCall = Schema.Schema.Type<typeof ToolCall>;

export const ToolResult = Schema.Struct({
  type: Schema.tag('tool-result'),
  id: ToolCallID,
  name: Schema.String,
  result: ToolResultValue,
  output: Schema.optional(ToolOutput),
  providerExecuted: Schema.optional(Schema.Boolean),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ToolResult' });
export type ToolResult = Schema.Schema.Type<typeof ToolResult>;

export const ToolError = Schema.Struct({
  type: Schema.tag('tool-error'),
  id: ToolCallID,
  name: Schema.String,
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ToolError' });
export type ToolError = Schema.Schema.Type<typeof ToolError>;

export const ModelFallback = Schema.Struct({
  type: Schema.tag('model-fallback'),
  from: ModelIdentity,
  to: ModelIdentity,
  trigger: JsonRecord,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.ModelFallback' });
export type ModelFallback = Schema.Schema.Type<typeof ModelFallback>;

export const StepFinish = Schema.Struct({
  type: Schema.tag('step-finish'),
  index: Schema.Number,
  reason: FinishReason,
  usage: Schema.optional(Usage),
  quota: Schema.optional(QuotaObservation),
  requestId: Schema.optional(Schema.String),
  native: Schema.optional(JsonRecord),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.StepFinish' });
export type StepFinish = Schema.Schema.Type<typeof StepFinish>;

export const Finish = Schema.Struct({
  type: Schema.tag('finish'),
  reason: FinishReason,
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Event.Finish' });
export type Finish = Schema.Schema.Type<typeof Finish>;

const llmEventTagged = Schema.Union([
  StepStart,
  InputUsageMeasured,
  TextStart,
  TextDelta,
  TextEnd,
  ReasoningStart,
  ReasoningDelta,
  ReasoningEnd,
  ToolInputStart,
  ToolInputDelta,
  ToolInputEnd,
  ToolCall,
  ToolResult,
  ToolError,
  ModelFallback,
  StepFinish,
  Finish,
]).pipe(Schema.toTaggedUnion('type'));

type WithID<Event extends { readonly id: unknown }, ID> = Omit<Event, 'type' | 'id'> & { readonly id: ID | string };
type WithUsage<Event extends { readonly usage?: Usage }> = Omit<Event, 'type' | 'usage'> & {
  readonly usage?: UsageInput;
};

const contentBlockID = (value: ContentBlockID | string) => ContentBlockID.make(value);
const toolCallID = (value: ToolCallID | string) => ToolCallID.make(value);

export const LLMEvent = Object.assign(llmEventTagged, {
  stepStart: StepStart.make,
  inputUsage: (input: { readonly inputUsage: InputUsageInput; readonly messageId?: string | undefined }) =>
    InputUsageMeasured.make({
      type: 'input-usage',
      inputUsage: InputUsage.from(input.inputUsage),
      messageId: input.messageId,
    }),
  textStart: (input: WithID<TextStart, ContentBlockID>) => TextStart.make({ ...input, id: contentBlockID(input.id) }),
  textDelta: (input: WithID<TextDelta, ContentBlockID>) => TextDelta.make({ ...input, id: contentBlockID(input.id) }),
  textEnd: (input: WithID<TextEnd, ContentBlockID>) => TextEnd.make({ ...input, id: contentBlockID(input.id) }),
  reasoningStart: (input: WithID<ReasoningStart, ContentBlockID>) => ReasoningStart.make({ ...input, id: contentBlockID(input.id) }),
  reasoningDelta: (input: WithID<ReasoningDelta, ContentBlockID>) => ReasoningDelta.make({ ...input, id: contentBlockID(input.id) }),
  reasoningEnd: (input: WithID<ReasoningEnd, ContentBlockID>) => ReasoningEnd.make({ ...input, id: contentBlockID(input.id) }),
  toolInputStart: (input: WithID<ToolInputStart, ToolCallID>) => ToolInputStart.make({ ...input, id: toolCallID(input.id) }),
  toolInputDelta: (input: WithID<ToolInputDelta, ToolCallID>) => ToolInputDelta.make({ ...input, id: toolCallID(input.id) }),
  toolInputEnd: (input: WithID<ToolInputEnd, ToolCallID>) => ToolInputEnd.make({ ...input, id: toolCallID(input.id) }),
  toolCall: (input: WithID<ToolCall, ToolCallID>) => ToolCall.make({ ...input, id: toolCallID(input.id) }),
  toolResult: (input: WithID<ToolResult, ToolCallID>) =>
    ToolResult.make({
      ...input,
      id: toolCallID(input.id),
      output: input.output === undefined ? undefined : ToolOutput.from(input.output.structured, input.output.content),
    }),
  toolError: (input: WithID<ToolError, ToolCallID>) => ToolError.make({ ...input, id: toolCallID(input.id) }),
  modelFallback: ModelFallback.make,
  stepFinish: (input: WithUsage<StepFinish>) =>
    StepFinish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  finish: (input: WithUsage<Finish>) =>
    Finish.make({
      ...input,
      usage: input.usage === undefined ? undefined : Usage.from(input.usage),
    }),
  is: {
    stepStart: llmEventTagged.guards['step-start'],
    inputUsage: llmEventTagged.guards['input-usage'],
    textStart: llmEventTagged.guards['text-start'],
    textDelta: llmEventTagged.guards['text-delta'],
    textEnd: llmEventTagged.guards['text-end'],
    reasoningStart: llmEventTagged.guards['reasoning-start'],
    reasoningDelta: llmEventTagged.guards['reasoning-delta'],
    reasoningEnd: llmEventTagged.guards['reasoning-end'],
    toolInputStart: llmEventTagged.guards['tool-input-start'],
    toolInputDelta: llmEventTagged.guards['tool-input-delta'],
    toolInputEnd: llmEventTagged.guards['tool-input-end'],
    toolCall: llmEventTagged.guards['tool-call'],
    toolResult: llmEventTagged.guards['tool-result'],
    toolError: llmEventTagged.guards['tool-error'],
    modelFallback: llmEventTagged.guards['model-fallback'],
    stepFinish: llmEventTagged.guards['step-finish'],
    finish: llmEventTagged.guards.finish,
  },
});
export type LLMEvent = Schema.Schema.Type<typeof llmEventTagged>;

export class PreparedRequest extends Schema.Class<PreparedRequest>('LLM.PreparedRequest')({
  id: Schema.String,
  route: RouteID,
  protocol: ProtocolID,
  model: ModelSchema,
  body: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export type PreparedRequestOf<Body> = Omit<PreparedRequest, 'body'> & {
  readonly body: Body;
};

const responseWords = (events: ReadonlyArray<LLMEvent>, kind: 'text' | 'reasoning', message?: Message): string => {
  const chunks: string[] = [];
  let length = 0;
  for (const event of events) {
    if ((event.type === 'text-delta' && kind === 'text') || (event.type === 'reasoning-delta' && kind === 'reasoning')) {
      chunks.push(event.text);
      length += event.text.length;
    }
  }
  for (const part of message?.content ?? []) {
    if ((part.type !== 'text' && part.type !== 'reasoning') || part.type !== kind || part.text.length !== length) continue;
    let offset = 0;
    for (const chunk of chunks) {
      if (!part.text.startsWith(chunk, offset)) break;
      offset += chunk.length;
    }
    if (offset === length) return part.text;
    break;
  }
  return chunks.join('');
};

const responseUsage = (events: ReadonlyArray<LLMEvent>) =>
  events.reduce<Usage | undefined>((usage, event) => ('usage' in event && event.usage !== undefined ? event.usage : usage), undefined);

export class LLMResponse extends Schema.Class<LLMResponse>('LLM.Response')({
  message: Message,
  events: Schema.Array(LLMEvent),
  usage: Schema.optional(Usage),
  finishReason: FinishReason,
}) {
  get text() {
    return responseWords(this.events, 'text', this.message);
  }

  get reasoning() {
    return responseWords(this.events, 'reasoning', this.message);
  }

  get toolCalls() {
    return this.events.filter(LLMEvent.is.toolCall);
  }
}

export namespace LLMResponse {
  export type Output = LLMResponse | { readonly events: ReadonlyArray<LLMEvent>; readonly usage?: Usage };

  export const text = (response: Output) =>
    responseWords(response.events, 'text', response instanceof LLMResponse ? response.message : undefined);

  export const usage = (response: Output) => response.usage ?? responseUsage(response.events);

  export const toolCalls = (response: Output) => response.events.filter(LLMEvent.is.toolCall);

  export const reasoning = (response: Output) =>
    responseWords(response.events, 'reasoning', response instanceof LLMResponse ? response.message : undefined);
}
