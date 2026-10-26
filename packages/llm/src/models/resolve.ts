import { Effect, Result } from 'effect';
import { InvalidRequestReason, LLMError, NotInstalledReason } from '../llm/schema/errors';
import { Model, type ToolChoiceMode, ModelIdentity, type ProviderOptions } from '../llm/schema/options';
import { ModelID, ProviderID } from '../llm/schema/ids';
import type { ModelCompactionPolicy } from '../profiles/ModelCompactionPolicy';
import type {
  ModelContinuationPolicy,
  ModelCredentials,
  OutputReservation,
  ProfileCall,
  ProviderRegistration,
  ToolResultRetentionPolicy,
} from '../profiles/contract';
import type { VendorWeb } from '../profiles/vendorWeb';

import { chosenSwitches, type ModelSwitches } from './description';
import type { ModelRetryPolicy } from '../llm/route/ModelRetryPolicy';
import type { ModelCatalog, ModelOption } from './catalog';

export type ModelCallSelection = {
  readonly ownerId: string;
  readonly runId?: string;
  readonly account?: string;
  readonly provider: string;
  readonly model?: string | null;
  readonly reasoning?: string | null;
  readonly switches?: ModelSwitches;
  readonly reasoningOutput?: boolean;
  readonly parallelToolCalls?: boolean;
  readonly cacheGroup?: string;
  readonly lane?: string;
  readonly maxOutputTokens?: number;
  readonly credentials: ModelCredentials;
};

export type ResolvedModelCall = {
  readonly retry?: ModelRetryPolicy;
  readonly continuation?: ModelContinuationPolicy;
  readonly identity: ModelIdentity;
  readonly model: Effect.Effect<Model, LLMError>;
  readonly toolChoice?: readonly ToolChoiceMode[];
  readonly web?: Effect.Effect<VendorWeb, LLMError>;
  readonly providerOptions: ProviderOptions | undefined;
  readonly resultRetention?: ToolResultRetentionPolicy;
  readonly compaction?: ModelCompactionPolicy;
  readonly maxOutputTokens: number | null;
  readonly plannedOutputTokens: number;
  readonly contextWindow: number | undefined;
  readonly rung: string | null;
  readonly images: boolean;
};

export function callRung(selected: { readonly defaultReasoning: string | null }, reasoning: string | null | undefined): string | null {
  return reasoning ?? selected.defaultReasoning;
}

const lowest = (values: readonly (number | undefined)[]) => Math.min(...values.filter((value): value is number => value !== undefined));

const budgetOf = (output: OutputReservation, model: string): number =>
  typeof output.budget === 'number' ? output.budget : output.budget(model);

export function plannedOutputTokens(output: OutputReservation, selected: ModelOption, cap?: number): number {
  return lowest([budgetOf(output, selected.id), selected.capacity?.output, cap]);
}

export function resolveModelCall(
  catalog: ModelCatalog<ProviderRegistration>,
  input: ModelCallSelection,
): Result.Result<ResolvedModelCall, LLMError> {
  if (!catalog.registered(input.provider)) {
    return Result.fail(
      new LLMError({
        module: 'LLM',
        method: 'resolveModelCall',
        reason: new NotInstalledReason({ provider: ProviderID.make(input.provider) }),
      }),
    );
  }
  try {
    return Result.succeed(resolveSelection(catalog, input));
  } catch (cause) {
    return Result.fail(selectionRefusal('resolveModelCall', cause));
  }
}

export function selectionRefusal(method: string, cause: unknown): LLMError {
  if (cause instanceof LLMError) return cause;
  return new LLMError({
    module: 'LLM',
    method,
    reason: new InvalidRequestReason({ message: cause instanceof Error ? cause.message : String(cause) }),
  });
}

function resolveSelection(catalog: ModelCatalog<ProviderRegistration>, input: ModelCallSelection): ResolvedModelCall {
  const registration = catalog.named(input.provider);
  const selected = catalog.resolveTextModel(registration.id, input.model ?? null);
  if (
    input.reasoning !== null &&
    input.reasoning !== undefined &&
    !selected.reasoningOptions.some((option) => option.id === input.reasoning)
  ) {
    throw new Error(`Reasoning level "${input.reasoning}" is not configured for ${selected.key}.`);
  }
  const profile = registration.profile;
  const selection = {
    ownerId: input.ownerId,
    runId: input.runId,
    account: input.account,
    model: selected.id,
    credentials: input.credentials,
    cacheGroup: input.cacheGroup,
    lane: input.lane,
  };
  const outputTokens = plannedOutputTokens(profile.output, selected, input.maxOutputTokens);
  const sentTokens = profile.output.verbatim
    ? outputTokens
    : lowest([selected.capacity?.output ?? budgetOf(profile.output, selected.id), input.maxOutputTokens]);
  const call: ProfileCall = {
    model: selected.id,
    rung: callRung(selected, input.reasoning),
    adaptive: selected.supportsAdaptiveThinking,
    reasoningOutput: input.reasoningOutput ?? true,
    outputTokens,
    switches: chosenSwitches(selected.switches, input.switches),
    parallelToolCalls: input.parallelToolCalls,
    cacheGroup: input.cacheGroup || undefined,
  };
  const providerOptions = profile.options(call);
  const web = profile.web?.(selection, call);
  return {
    web,
    retry: profile.retry?.(selection),
    continuation: profile.continuation,
    identity: new ModelIdentity({ provider: ProviderID.make(registration.id), model: ModelID.make(selected.id) }),
    model: profile
      .model({
        ownerId: input.ownerId,
        runId: input.runId,
        account: input.account,
        model: selected.id,
        credentials: input.credentials,
        cacheGroup: input.cacheGroup || undefined,
        lane: input.lane || undefined,
      })
      .pipe(
        Effect.map((model) =>
          selected.toolChoice === undefined
            ? model
            : Model.update(model, {
                compatibility: { ...model.compatibility, toolChoice: selected.toolChoice },
              }),
        ),
      ),
    toolChoice: selected.toolChoice,
    providerOptions,
    resultRetention: profile.resultRetention,
    compaction: profile.compaction,
    maxOutputTokens: profile.output.sent ? sentTokens : null,
    plannedOutputTokens: outputTokens,
    contextWindow: selected.capacity?.context,
    rung: callRung(selected, input.reasoning),
    images: selected.capabilities.includes('vision'),
  };
}
