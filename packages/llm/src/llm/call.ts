import { Effect, JsonSchema, Schema, SchemaRepresentation } from 'effect';
import { LlmClient, fold } from './route/client';
import {
  type ContentPart,
  LLMRequest,
  Message,
  SystemPart,
  ToolChoice,
  ToolDefinition,
  type ToolResultPart,
  toolInputSchema,
} from './schema/messages';
import {
  GenerationOptions,
  HttpOptions,
  type ModelInput as SchemaModelInput,
  type ToolChoiceMode as AllowedToolChoice,
} from './schema/options';
import { ContentPolicyReason, InvalidProviderOutputReason, LLMError } from './schema/errors';
import { LLMEvent, type LLMResponse } from './schema/events';

export type AnswerSchema<T> = Schema.Codec<T, any, never, never>;

export type ModelInput = SchemaModelInput;

export type MessageInput = Message.Input;

export type ToolChoiceInput = ToolChoice.Input;
export type ToolChoiceMode = ToolChoice.Mode;

export type ToolResultInput = Parameters<typeof ToolResultPart.from>[0];

export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  'system' | 'messages' | 'tools' | 'toolChoice' | 'generation' | 'http' | 'providerOptions'
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>;
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>;
  readonly messages?: ReadonlyArray<Message | MessageInput>;
  readonly tools?: ReadonlyArray<ToolDefinition.Input>;
  readonly toolChoice?: ToolChoiceInput;
  readonly generation?: GenerationOptions.Input;
  readonly providerOptions?: ConstructorParameters<typeof LLMRequest>[0]['providerOptions'];
  readonly http?: HttpOptions.Input;
};

export const requestInput = (input: LLMRequest): RequestInput => ({
  ...LLMRequest.input(input),
});

export const request = (input: RequestInput) => {
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    providerOptions: requestProviderOptions,
    http: requestHttp,
    ...rest
  } = input;
  return new LLMRequest({
    ...rest,
    system: SystemPart.content(requestSystem),
    messages: [...(messages?.map(Message.make) ?? []), ...(prompt === undefined ? [] : [Message.user(prompt)])],
    tools: tools?.map(ToolDefinition.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: requestHttp === undefined ? undefined : HttpOptions.make(requestHttp),
  });
};

export const updateRequest = (input: LLMRequest, patch: Partial<RequestInput>) => request({ ...requestInput(input), ...patch });

const GENERATE_OBJECT_TOOL_NAME = 'generate_object';

const GENERATE_OBJECT_TOOL_DESCRIPTION = 'Return the structured result by calling this tool.';

type GenerateObjectBase = Omit<RequestInput, 'tools' | 'toolChoice' | 'responseFormat'> & {
  readonly onEvent?: (event: LLMEvent) => void;
};

export class GenerateObjectResponse<T> {
  constructor(
    readonly object: T,
    readonly response: LLMResponse,
  ) {}

  get events() {
    return this.response.events;
  }

  get usage() {
    return this.response.usage;
  }
}

export interface GenerateObjectOptions<S extends AnswerSchema<any>> extends GenerateObjectBase {
  readonly schema: S;
}

export interface GenerateObjectDynamicOptions extends GenerateObjectBase {
  readonly jsonSchema: JsonSchema.JsonSchema;
}

type AnswerTool = {
  readonly definition: ToolDefinition;
  readonly decode: (input: unknown) => Effect.Effect<unknown, Schema.SchemaError>;
};

const jsonAnswerSchemas = new WeakMap<JsonSchema.JsonSchema, AnswerSchema<unknown>>();

const jsonAnswerSchema = (jsonSchema: JsonSchema.JsonSchema): AnswerSchema<unknown> => {
  const held = jsonAnswerSchemas.get(jsonSchema);
  if (held !== undefined) return held;
  const imported = SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(jsonSchema), {
    patterns: 'apply',
  }) as AnswerSchema<unknown>;
  jsonAnswerSchemas.set(jsonSchema, imported);
  return imported;
};

export const decodeJsonAnswer =
  (jsonSchema: JsonSchema.JsonSchema) =>
  (input: unknown): Effect.Effect<unknown, Schema.SchemaError> =>
    Effect.flatMap(
      Effect.sync(() => jsonAnswerSchema(jsonSchema)),
      (schema) => Schema.decodeUnknownEffect(schema)(input),
    );

const answerTool = (shape: { readonly schema: AnswerSchema<unknown> } | { readonly jsonSchema: JsonSchema.JsonSchema }): AnswerTool => ({
  definition: new ToolDefinition({
    name: GENERATE_OBJECT_TOOL_NAME,
    description: GENERATE_OBJECT_TOOL_DESCRIPTION,
    inputSchema: 'schema' in shape ? toolInputSchema(shape.schema) : shape.jsonSchema,
  }),
  decode: 'schema' in shape ? Schema.decodeUnknownEffect(shape.schema) : decodeJsonAnswer(shape.jsonSchema),
});

const answerChoice = (allowed: readonly AllowedToolChoice[] | undefined): ToolChoice =>
  allowed === undefined || allowed.includes('tool')
    ? ToolChoice.named(GENERATE_OBJECT_TOOL_NAME)
    : ToolChoice.make(allowed.includes('required') ? 'required' : 'auto');

const runGenerateObject = Effect.fn('LLM.generateObject')(function* (options: GenerateObjectBase, tool: AnswerTool) {
  const { onEvent, ...requestOptions } = options;
  const baseRequest = request(requestOptions);
  const generateRequest = LLMRequest.update(baseRequest, {
    tools: [tool.definition],
    toolChoice: answerChoice(baseRequest.model.compatibility?.toolChoice),
  });
  const response = yield* fold(generateRequest, onEvent);
  if (response.finishReason === 'content-filter')
    return yield* new LLMError({
      module: 'LLM',
      method: 'generateObject',
      reason: new ContentPolicyReason({ message: 'generateObject: the provider withheld the answer under its content policy' }),
    });
  const call = response.toolCalls.find((event) => LLMEvent.is.toolCall(event) && event.name === GENERATE_OBJECT_TOOL_NAME);
  if (!call || !LLMEvent.is.toolCall(call))
    return yield* new LLMError({
      module: 'LLM',
      method: 'generateObject',
      reason: new InvalidProviderOutputReason({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    });
  const object = yield* tool.decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new LLMError({
          module: 'LLM',
          method: 'generateObject',
          reason: new InvalidProviderOutputReason({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
          }),
        }),
    ),
  );
  return new GenerateObjectResponse(object, response);
});

export function generateObject<S extends AnswerSchema<any>>(
  options: GenerateObjectOptions<S>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, LLMError, LlmClient>;
export function generateObject(options: GenerateObjectDynamicOptions): Effect.Effect<GenerateObjectResponse<unknown>, LLMError, LlmClient>;
export function generateObject(options: GenerateObjectOptions<AnswerSchema<any>> | GenerateObjectDynamicOptions) {
  if ('schema' in options) {
    const { schema, ...rest } = options;
    return runGenerateObject(rest, answerTool({ schema }));
  }
  const { jsonSchema, ...rest } = options;
  return runGenerateObject(rest, answerTool({ jsonSchema }));
}
