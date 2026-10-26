import { Schema, SchemaGetter } from 'effect';
import { jsonCodec } from '@runlith/utils/codec';
import { toJson } from '@runlith/utils/json';
import { isRecord } from '../utils/record';
import { carriedByJson, JsonRecord, JsonSchema, MessageRole, ProviderMetadata } from './ids';
import {
  CacheHint,
  CachePolicy,
  GenerationOptions,
  HttpOptions,
  ModelIdentity,
  ModelSchema,
  ProviderOptions,
  ToolChoiceMode,
} from './options';
import { ToolContent } from './tool-content';
import { CompactionContext, CompactionSummary } from './compaction';

const systemPartSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(JsonRecord),
}).annotate({ identifier: 'LLM.SystemPart' });
export type SystemPart = Schema.Schema.Type<typeof systemPartSchema>;

const makeSystemPart = (text: string): SystemPart => ({ type: 'text', text });

export const SystemPart = Object.assign(systemPartSchema, {
  from: makeSystemPart,
  content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
    if (input === undefined) return [];
    return typeof input === 'string' ? [makeSystemPart(input)] : Array.isArray(input) ? [...input] : [input];
  },
});

export const TextPart = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  deferredTools: Schema.optional(Schema.Array(Schema.String)),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(JsonRecord),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Content.Text' });
export type TextPart = Schema.Schema.Type<typeof TextPart>;

export const MediaPart = Schema.Struct({
  type: Schema.Literal('media'),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(JsonRecord),
}).annotate({ identifier: 'LLM.Content.Media' });
export type MediaPart = Schema.Schema.Type<typeof MediaPart>;

const toolResultValueSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('json'),
    value: carriedByJson,
  }),
  Schema.Struct({
    type: Schema.Literal('text'),
    value: carriedByJson,
  }),
  Schema.Struct({
    type: Schema.Literal('error'),
    value: carriedByJson,
  }),
  Schema.Struct({
    type: Schema.Literal('content'),
    value: Schema.Array(ToolContent),
  }),
])
  .annotate({ identifier: 'LLM.ToolResult' })
  .pipe(Schema.toTaggedUnion('type'));
export type ToolResultValue = Schema.Schema.Type<typeof toolResultValueSchema>;

export const ToolResultRetention = Schema.Struct({
  outputId: Schema.String,
  format: Schema.Literals(['text', 'json']),
  byteLength: Schema.Number,
  lineCount: Schema.Number,
  location: Schema.optional(Schema.String),
  contentLocation: Schema.optional(Schema.String),
}).annotate({ identifier: 'LLM.ToolResultRetention' });
export type ToolResultRetention = Schema.Schema.Type<typeof ToolResultRetention>;

const isToolResultShape = (value: unknown): value is { type: ToolResultValue['type']; value: unknown } =>
  isRecord(value) &&
  (value['type'] === 'json' || value['type'] === 'text' || value['type'] === 'error' || value['type'] === 'content') &&
  'value' in value;

export const ToolResultValue = Object.assign(toolResultValueSchema, {
  from: (value: unknown, type: ToolResultValue['type'] = 'json'): ToolResultValue => {
    const kind = isToolResultShape(value) ? value.type : type;
    const carried = isToolResultShape(value) ? value.value : value;
    if (kind === 'content') return { type: kind, value: Array.isArray(carried) ? carried : [] };
    return { type: kind, value: toJson(carried) };
  },
});

export interface ToolOutput {
  readonly structured: unknown;
  readonly content: ReadonlyArray<ToolContent>;
}

export const ToolOutput = Object.assign(
  Schema.Struct({
    structured: Schema.Unknown,
    content: Schema.Array(ToolContent),
  }).annotate({ identifier: 'LLM.ToolOutput' }),
  {
    from: (structured: unknown, content: ReadonlyArray<ToolContent> = []): ToolOutput => ({ structured, content }),
    fromResultValue: (result: ToolResultValue): ToolOutput | undefined => {
      switch (result.type) {
        case 'json':
          return { structured: result.value, content: [] };
        case 'text':
          return { structured: {}, content: [{ type: 'text', text: toolResultText(result.value) }] };
        case 'content':
          return { structured: {}, content: result.value };
        case 'error':
          return undefined;
      }
    },
    toResultValue: (output: ToolOutput): ToolResultValue => {
      if (output.content.length === 0) return { type: 'json', value: output.structured };
      if (output.content.length === 1 && output.content[0]?.type === 'text') return { type: 'text', value: output.content[0].text };
      return { type: 'content', value: output.content };
    },
  },
);

const toolResultText = (value: unknown) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

export const ToolCallPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
    unparsed: Schema.optional(Schema.String),
    providerExecuted: Schema.optional(Schema.Boolean),
    cache: Schema.optional(CacheHint),
    metadata: Schema.optional(JsonRecord),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: 'LLM.Content.ToolCall' }),
  {
    from: (input: Omit<ToolCallPart, 'type'>): ToolCallPart => ({ type: 'tool-call', ...input }),
  },
);
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>;

export const ToolResultPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal('tool-result'),
    id: Schema.String,
    name: Schema.String,
    result: ToolResultValue,
    toolReferences: Schema.optional(Schema.Array(Schema.String)),
    providerExecuted: Schema.optional(Schema.Boolean),
    retained: Schema.optional(ToolResultRetention),
    durationMs: Schema.optional(Schema.Int),
    cache: Schema.optional(CacheHint),
    metadata: Schema.optional(JsonRecord),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: 'LLM.Content.ToolResult' }),
  {
    from: (
      input: Omit<ToolResultPart, 'type' | 'result'> & {
        readonly result: unknown;
        readonly resultType?: ToolResultValue['type'];
      },
    ): ToolResultPart => ({
      type: 'tool-result',
      id: input.id,
      name: input.name,
      result: ToolResultValue.from(input.result, input.resultType),
      toolReferences: input.toolReferences,
      providerExecuted: input.providerExecuted,
      retained: input.retained,
      durationMs: input.durationMs,
      cache: input.cache,
      metadata: input.metadata,
      providerMetadata: input.providerMetadata,
    }),
  },
);
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>;

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal('reasoning'),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(JsonRecord),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Content.Reasoning' });
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>;

export const ModelFallbackPart = Schema.Struct({
  type: Schema.Literal('model-fallback'),
  from: ModelIdentity,
  to: ModelIdentity,
  trigger: JsonRecord,
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Content.ModelFallback' });
export type ModelFallbackPart = Schema.Schema.Type<typeof ModelFallbackPart>;

export const ContentPart = Schema.Union([TextPart, MediaPart, ToolCallPart, ToolResultPart, ReasoningPart, ModelFallbackPart]).pipe(
  Schema.toTaggedUnion('type'),
);
export type ContentPart = Schema.Schema.Type<typeof ContentPart>;

export class Message extends Schema.Class<Message>('LLM.Message')({
  id: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  origin: Schema.optional(ModelIdentity),
  compaction: Schema.optional(CompactionSummary),
  metadata: Schema.optional(JsonRecord),
  native: Schema.optional(JsonRecord),
}) {}

export namespace Message {
  export type ContentInput = string | ContentPart | ReadonlyArray<ContentPart>;
  export type SystemContentInput = string | TextPart | ReadonlyArray<TextPart>;
  export type Input = Omit<ConstructorParameters<typeof Message>[0], 'content'> & {
    readonly content: ContentInput;
  };

  export const text = (value: string): ContentPart => ({ type: 'text', text: value });

  export const content = (input: ContentInput) => (typeof input === 'string' ? [text(input)] : Array.isArray(input) ? [...input] : [input]);

  export const make = (input: Message | Input) => {
    if (input instanceof Message) return input;
    return new Message({ ...input, content: content(input.content) });
  };

  export const user = (content: ContentInput) => make({ role: 'user', content });

  export const assistant = (content: ContentInput) => make({ role: 'assistant', content });

  export const system = (content: SystemContentInput) => make({ role: 'system', content });

  export const tool = (result: ToolResultPart | Parameters<typeof ToolResultPart.from>[0]) =>
    make({ role: 'tool', content: ['type' in result ? result : ToolResultPart.from(result)] });
}

export const VendorWire = Schema.Struct({
  name: Schema.String,
  namespace: Schema.optional(Schema.Struct({ name: Schema.String, description: Schema.String })),
});
export type VendorWire = Schema.Schema.Type<typeof VendorWire>;

export class ToolDefinition extends Schema.Class<ToolDefinition>('LLM.ToolDefinition')({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(JsonRecord),
  native: Schema.optional(JsonRecord),
  vendorWire: Schema.optional(VendorWire),
  deferred: Schema.optional(Schema.Literal(true)),
}) {}

export namespace ToolDefinition {
  export type Input = ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0];

  export const make = (input: Input) => (input instanceof ToolDefinition ? input : new ToolDefinition(input));
}

export const toJsonSchema = (schema: Schema.Top): JsonSchema => {
  const document = Schema.toJsonSchemaDocument(jsonCodec(schema), { onExcessProperty: 'error' });
  if (Object.keys(document.definitions).length === 0) return document.schema;
  return { ...document.schema, $defs: document.definitions };
};

const toolInputSchemas = new WeakMap<object, JsonSchema>();

export const toolInputSchema = (schema: Schema.Top): JsonSchema => {
  const cached = toolInputSchemas.get(schema);
  if (cached !== undefined) return cached;
  const compiled = objectRooted(toJsonSchema(schema));
  toolInputSchemas.set(schema, compiled);
  return compiled;
};

const objectRooted = (schema: JsonSchema): JsonSchema => {
  if (schema.type === 'object') return schema;
  const { not: excluded, ...open } = schema;
  if (isNullOnly(excluded) && open.anyOf === undefined) return { ...open, type: 'object' };
  const { anyOf: union, ...rest } = schema;
  const objects = Array.isArray(union) ? union.filter(isObjectSchema) : [];
  if (objects.length === 1) return { ...rest, ...objects[0], type: 'object' };
  if (Array.isArray(union) && objects.length > 1 && objects.length === union.length) {
    return { ...rest, type: 'object', anyOf: objects };
  }
  throw new Error(
    'A tool input schema is one object at the root; this codec produced ' +
      (objects.length > 0 ? 'a union containing non-object shapes' : 'no object shape') +
      '. Declare the wire form on the tool as `inputSchema`, and keep the codec for decoding.',
  );
};

const isObjectSchema = (value: unknown): value is JsonSchema => isRecord(value) && (value.type === 'object' || 'properties' in value);

const isNullOnly = (value: unknown): boolean => isRecord(value) && value.type === 'null' && Object.keys(value).length === 1;

export class ToolChoice extends Schema.Class<ToolChoice>('LLM.ToolChoice')({
  type: ToolChoiceMode,
  name: Schema.optional(Schema.String),
}) {}

export namespace ToolChoice {
  export type Mode = Exclude<ToolChoice['type'], 'tool'>;
  export type Input = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string;

  const isMode = (value: string): value is Mode => value === 'auto' || value === 'none' || value === 'required';

  export const named = (value: string) => new ToolChoice({ type: 'tool', name: value });

  export const make = (input: Input) => {
    if (input instanceof ToolChoice) return input;
    if (input instanceof ToolDefinition) return named(input.name);
    if (typeof input === 'string') return isMode(input) ? new ToolChoice({ type: input }) : named(input);
    return new ToolChoice(input);
  };
}

export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text') }),
  Schema.Struct({ type: Schema.Literal('json'), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal('tool'), tool: ToolDefinition }),
]).pipe(Schema.toTaggedUnion('type'));
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>;

export class LLMRequest extends Schema.Class<LLMRequest>('LLM.Request')({
  id: Schema.optional(Schema.String),
  model: ModelSchema,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  responseFormat: Schema.optional(ResponseFormat),
  compaction: Schema.optional(CompactionContext),
  cache: Schema.optional(CachePolicy),
  liveness: Schema.optional(Schema.Number),
  metadata: Schema.optional(JsonRecord),
}) {}

export namespace LLMRequest {
  export type Input = ConstructorParameters<typeof LLMRequest>[0];

  export const input = (request: LLMRequest): Input => ({
    id: request.id,
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    generation: request.generation,
    providerOptions: request.providerOptions,
    http: request.http,
    responseFormat: request.responseFormat,
    compaction: request.compaction,
    cache: request.cache,
    liveness: request.liveness,
    metadata: request.metadata,
  });

  export const update = (request: LLMRequest, patch: Partial<Input>) => {
    if (Object.keys(patch).length === 0) return request;
    return new LLMRequest({
      ...input(request),
      ...patch,
      model: patch.model ?? request.model,
    });
  };
}
