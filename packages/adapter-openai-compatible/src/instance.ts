import { Effect, Schema } from 'effect';
import { Route } from '@runlith/llm/route/definition';
import { Endpoint } from '@runlith/llm/route/endpoint';
import * as Framing from '@runlith/llm/route/framing';

import type { ModelSpec } from '@runlith/llm/models/description';
import type { ProviderOptions } from '@runlith/llm/schema/options';
import type { ReasoningEffort } from '@runlith/llm/schema/ids';
import { ReasoningEfforts } from '@runlith/llm/schema/ids';
import * as OpenAICompatibleChat from '@runlith/llm/protocols/openai-compatible-chat';
import * as Auth from '@runlith/llm/route/auth';

import { reasoningRung } from '@runlith/llm/profiles/reasoning';
import type { ModelProfile, ProfileCall, ProviderQuota } from '@runlith/llm/profiles/contract';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
import type { SettingInstance, SettingRow, SettingValue, WireProvider } from '@runlith/tagma/adapter/provider';

export const TOOL_CHOICES = ['auto', 'none', 'required', 'tool'] as const;
type ToolChoice = (typeof TOOL_CHOICES)[number];

export const REASONING_FIELDS = ['reasoning_effort', 'thinking', 'both'] as const;
export type ReasoningField = (typeof REASONING_FIELDS)[number];

export const OUTPUT_CEILING = 32_000;

export type CompatibleModel = {
  readonly id: string;
  readonly label: string;
  readonly context: number;
  readonly output: number;
  readonly vision: boolean;
  readonly toolChoice: readonly ToolChoice[];
  readonly reasoning: readonly ReasoningEffort[];
  readonly defaultReasoning: ReasoningEffort | null;
  readonly reasoningField: string;
  readonly reasoningMapping: Readonly<Record<string, unknown>> | null;
};

export type CompatibleInstance = {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly key: string | null;
  readonly reasoningEcho: boolean;
  readonly models: readonly CompatibleModel[];
};

export const derivedOutput = (context: number): number => Math.max(1, Math.min(OUTPUT_CEILING, Math.floor(context / 4)));

const text = (value: SettingValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const count = (value: SettingValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const strings = (value: SettingValue | undefined): readonly string[] =>
  Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string') ? value : [];

const rows = (value: SettingValue | undefined): readonly SettingRow[] =>
  Array.isArray(value) ? value.filter((entry): entry is SettingRow => typeof entry === 'object' && entry !== null) : [];

const efforts = (value: SettingValue | undefined): readonly ReasoningEffort[] =>
  strings(value).filter((entry): entry is ReasoningEffort => (ReasoningEfforts as readonly string[]).includes(entry));

const toolChoices = (value: SettingValue | undefined): readonly ToolChoice[] =>
  strings(value).filter((entry): entry is ToolChoice => (TOOL_CHOICES as readonly string[]).includes(entry));

export const baseUrlOf = (value: SettingValue | undefined): string | undefined => {
  const given = text(value);
  if (given === undefined) return undefined;
  try {
    const url = new URL(given);
    return url.protocol === 'http:' || url.protocol === 'https:' ? given.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
};

const mappingOf = (value: SettingValue | undefined): Readonly<Record<string, unknown>> | null => {
  const source = text(value);
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Readonly<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
};

const modelOf = (row: SettingRow, field: string, mapping: Readonly<Record<string, unknown>> | null): CompatibleModel | null => {
  const id = text(row.id);
  const context = count(row.context);
  if (id === undefined || context === undefined) return null;
  const reasoning = efforts(row.reasoning);
  const chosen = text(row.defaultReasoning);
  const defaultReasoning = reasoning.find((level) => level === chosen) ?? null;
  return {
    id,
    label: text(row.label) ?? id,
    context,
    output: Math.min(count(row.output) ?? derivedOutput(context), context),
    vision: row.vision === true,
    toolChoice: toolChoices(row.toolChoice),
    reasoning,
    defaultReasoning,
    reasoningField: text(row.reasoningField) ?? field,
    reasoningMapping: mappingOf(row.reasoningMapping) ?? mapping,
  };
};

export const instanceOf = (instance: SettingInstance, secrets: SettingRow = {}): CompatibleInstance | null => {
  const name = text(instance.values.name);
  const baseUrl = baseUrlOf(instance.values.baseUrl);
  if (name === undefined || baseUrl === undefined) return null;
  const field = text(instance.values.reasoningField);
  const seen = new Set<string>();
  const mapping = mappingOf(instance.values.reasoningMapping);
  const models = rows(instance.values.models).flatMap((row) => {
    const model = modelOf(row, field ?? 'reasoning_effort', mapping);
    if (model === null || seen.has(model.id)) return [];
    seen.add(model.id);
    return [model];
  });
  return {
    id: instance.id,
    name,
    baseUrl,
    key: typeof secrets.key === 'string' && secrets.key !== '' ? secrets.key : null,
    reasoningEcho: instance.values.reasoningEcho === true,
    models,
  };
};

export const problemWith = (values: SettingRow): string | null => {
  if (text(values.reasoningMapping) !== undefined && mappingOf(values.reasoningMapping) === null)
    return 'The reasoning value mapping must be a JSON object keyed by reasoning level.';
  if (text(values.name) === undefined) return 'Name the provider.';
  if (baseUrlOf(values.baseUrl) === undefined) return 'The address must be an http or https URL, such as http://localhost:11434/v1.';
  const seen = new Set<string>();
  for (const row of rows(values.models)) {
    const id = text(row.id);
    if (id === undefined) return 'Every model needs its id.';
    if (seen.has(id)) return `Model ${id} is listed twice.`;
    seen.add(id);
    const context = count(row.context);
    if (context === undefined) return `Model ${id} needs its context window in tokens.`;
    if (row.output !== undefined && row.output !== '') {
      const output = count(row.output);
      if (output === undefined) return `Model ${id}: the output limit must be a whole number of tokens.`;
      if (output > context) return `Model ${id}: the output limit cannot exceed the context window of ${context} tokens.`;
    }
    if (text(row.reasoningMapping) !== undefined && mappingOf(row.reasoningMapping) === null)
      return `Model ${id}: the reasoning value mapping must be a JSON object keyed by reasoning level.`;
    const levels = strings(row.reasoning);
    if (efforts(levels).length !== levels.length) return `Model ${id}: a reasoning level is not one of ${ReasoningEfforts.join(', ')}.`;
    const chosen = text(row.defaultReasoning);
    if (chosen !== undefined && !levels.includes(chosen)) return `Model ${id}: the default reasoning level must be one of its levels.`;
  }
  return null;
};

const quota: ProviderQuota = {
  fromHeaders: () => null,
  read: () => Effect.fail(new QuotaUnsupported()),
};

const specOf = (model: CompatibleModel): ModelSpec => ({
  label: model.label,
  capacity: { context: model.context, output: model.output },
  capabilities: model.vision ? ['text', 'vision'] : ['text'],
  toolChoice: ['auto', ...model.toolChoice.filter((mode) => mode !== 'auto')],
  reasoning: model.reasoning,
  defaultReasoning: model.defaultReasoning,
});

const optionsOf = (call: ProfileCall): ProviderOptions =>
  OpenAICompatibleChat.options({
    reasoningEffort: reasoningRung(call.rung),
    parallelToolCalls: call.parallelToolCalls,
  });

const routeOf = (model: CompatibleModel) =>
  Route.make({
    id: OpenAICompatibleChat.route.id,
    endpoint: Endpoint.path('/chat/completions'),
    framing: Framing.sse,
    protocol: {
      ...OpenAICompatibleChat.protocol,
      body: {
        schema: Schema.Record(Schema.String, Schema.Unknown),
        from: (request) =>
          OpenAICompatibleChat.protocol.body.from(request).pipe(
            Effect.map((body) => {
              const { reasoning_effort: rung, ...plain } = body;
              if (rung === undefined) return plain;
              const mapped = model.reasoningMapping?.[rung];
              if (model.reasoningField === 'both')
                return {
                  ...plain,
                  ...(rung === 'none' ? {} : { reasoning_effort: mapped === undefined ? rung : mapped }),
                  thinking: { type: rung === 'none' ? 'disabled' : 'enabled' },
                };
              const value =
                mapped === undefined
                  ? model.reasoningField === 'thinking'
                    ? { type: rung === 'none' ? 'disabled' : 'enabled' }
                    : rung
                  : mapped;
              return { ...plain, [model.reasoningField]: value };
            }),
          ),
      },
    },
  });

const profileOf = (instance: CompatibleInstance): ModelProfile => {
  const models = new Map(instance.models.map((model) => [model.id, { output: model.output, route: routeOf(model) }]));
  const outputOf = (model: string): number => models.get(model)?.output ?? OUTPUT_CEILING;
  return {
    output: { budget: outputOf, sent: true },
    model: (selection) =>
      Effect.succeed(
        (models.get(selection.model)?.route ?? OpenAICompatibleChat.route)
          .with({
            provider: instance.id,
            endpoint: { baseURL: instance.baseUrl },
            limits: { output: outputOf(selection.model) },
            auth: instance.key === null ? Auth.none : Auth.bearer(instance.key),
          })
          .model({ id: selection.model, ...(instance.reasoningEcho ? { compatibility: { reasoningEcho: 'required' as const } } : {}) }),
      ),
    options: optionsOf,
  };
};

export const providerOf = (instance: CompatibleInstance): WireProvider | null => {
  const first = instance.models[0];
  if (first === undefined) return null;
  return {
    kind: 'wire',
    id: instance.id,
    label: instance.name,
    auth: 'api-key',
    keyScope: 'identity',
    keyHint: 'Leave it out when the server needs none.',
    models: Object.fromEntries(instance.models.map((model) => [model.id, specOf(model)])),
    cacheLifetime: { promisedSeconds: null, prior: null },
    defaultTextModel: first.id,
    profile: profileOf(instance),
    quota,
  };
};
