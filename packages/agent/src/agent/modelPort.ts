import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Effect, Stream } from 'effect';
import type { CachePolicy, ModelIdentity, ProviderOptions, ToolChoiceMode } from '@runlith/llm/schema/options';
import type { CompactionContext } from '@runlith/llm/schema/compaction';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import type { LLMError } from '@runlith/llm/schema/errors';
import type { LLMEvent, LLMResponse } from '@runlith/llm/schema/events';
import type { Message, ToolDefinition } from '@runlith/llm/schema/messages';
import type { ModelContinuationPolicy, ToolResultRetentionPolicy } from '@runlith/llm/profiles/contract';
import type { ServedWeb } from '@runlith/llm/profiles/vendorWeb';
import type { Tool } from './tool';
import type { ToolCatalog } from './ToolCatalog';
import type { ModelRetryPolicy } from '@runlith/llm/route/ModelRetryPolicy';

export type ModelToolChoice = { type: 'tool'; toolName: string } | 'required';

export type ModelCallStep = { readonly number: number; readonly attempt: number };

export type ModelStreamInput = {
  readonly messages: readonly Message[];
  readonly tools: ToolCatalog;
  readonly activeTools?: readonly string[] | undefined;
  readonly toolChoice?: ModelToolChoice | undefined;
  readonly stallMs?: number;
  readonly step?: ModelCallStep;
  readonly opened?: (activity: string) => void;
};

export type ModelOneShotInput = (
  | { readonly prompt: string; readonly messages?: never }
  | { readonly messages: readonly Message[]; readonly prompt?: never }
) & {
  readonly stallMs?: number;
  readonly onEvent?: (event: LLMEvent) => void;
};

export type ModelTextCall = Effect.Effect<LLMResponse, LLMError>;

export type ModelCompactionInput = {
  readonly instructions: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly context: CompactionContext;
};

export interface ModelCompaction {
  select(messages: readonly Message[], alreadyCovered: number): number | null;
  summarize(input: ModelCompactionInput): Effect.Effect<{ readonly summary: string; readonly response: LLMResponse }, LLMError>;
}

export type ModelAnswerShape<T> = {
  readonly schema: Tool.ToolSchema<T>;
  readonly jsonSchema?: JsonSchema;
};

export type ModelObjectCall<T> = Effect.Effect<{ readonly object: T; readonly response: LLMResponse }, LLMError>;

export type ModelRequestInput = {
  readonly ownerId: string;
  readonly runId?: string;
  readonly account?: string;
  readonly provider: string;
  readonly model?: string | null;
  readonly reasoning?: string | null;
  readonly switches?: ModelSwitches;
  readonly instructions?: string;
  readonly reasoningOutput?: boolean;
  readonly parallelToolCalls?: boolean;
  readonly cacheGroup?: string;
  readonly lane?: string;
  readonly cache?: CachePolicy;
  readonly maxOutputTokens?: number;
  readonly stallMs?: number;
};

export type ModelRequest = {
  readonly retry?: ModelRetryPolicy;
  readonly continuation?: ModelContinuationPolicy;
  readonly system?: string;
  readonly providerOptions?: ProviderOptions;
  readonly origin?: ModelIdentity;
  readonly rung?: string | null;
  readonly cache?: CachePolicy;
  readonly toolChoice?: readonly ToolChoiceMode[];
  readonly plannedOutputTokens: number;
  readonly images?: boolean;
  readonly resultRetention?: ToolResultRetentionPolicy;
  readonly compaction?: ModelCompaction;
  readonly refusal?: LLMError;
  readonly web?: Effect.Effect<ServedWeb, LLMError>;
  readonly signedAccount?: () => string | undefined;
  stream(input: ModelStreamInput): Stream.Stream<LLMEvent, LLMError>;
  text(input: ModelOneShotInput): ModelTextCall;
  object<T>(input: ModelOneShotInput & ModelAnswerShape<T>): ModelObjectCall<T>;
};

export interface ModelRequester {
  request(input: ModelRequestInput): ModelRequest;
}
