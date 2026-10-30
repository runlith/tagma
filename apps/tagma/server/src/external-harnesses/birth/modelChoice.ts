import { Effect } from 'effect';
import { servingProvider } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { HarnessModelChoice } from '@runlith/tagma/adapter/harness';
import type { HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';

export type ChosenModel =
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Chosen'; readonly choice: HarnessModelChoice }
  | { readonly _tag: 'Unavailable'; readonly reason: string; readonly unblock: Unblock };

const unavailable = (reason: string, unblock: Unblock): ChosenModel => ({ _tag: 'Unavailable', reason, unblock });

export function chosenModel(
  models: ModelCatalog,
  adapter: HarnessAdapter,
  asked: HarnessAskedModel | undefined,
  transport: HarnessTransport = 'terminal',
): ChosenModel {
  if (asked === undefined) return { _tag: 'None' };
  const provider = servingProvider(adapter, transport);
  if (provider === null) {
    return unavailable(`${adapter.label} declares no model surface, so ${asked.model} cannot reach it.`, [
      'start it without a model',
      'start it on a harness that carries one',
    ]);
  }
  if (!models.registered(provider)) {
    return unavailable(`This installation composes no ${provider} row, so nothing says which models ${adapter.label} serves.`, [
      'start it without a model',
    ]);
  }
  const row = models.named(provider);
  const served = models.modelsOf(provider);
  const option = models.findTextModel(provider, asked.model);
  if (option === undefined) {
    return unavailable(`${row.label} does not serve ${asked.model}; it serves ${served.map((one) => one.id).join(', ')}.`, [
      `name one of the models ${row.label} serves`,
    ]);
  }
  if (asked.reasoning !== null && !option.reasoningOptions.some((rung) => rung.id === asked.reasoning)) {
    return unavailable(
      option.reasoningOptions.length === 0
        ? `${row.label}'s ${asked.model} takes no reasoning rung, and ${asked.reasoning} was named.`
        : `${row.label}'s ${asked.model} has no ${asked.reasoning} rung; it offers ${option.reasoningOptions.map((rung) => rung.id).join(', ')}.`,
      option.reasoningOptions.length === 0
        ? ['start it without a rung']
        : [`name one of: ${option.reasoningOptions.map((rung) => rung.id).join(', ')}`],
    );
  }
  if (row.spell === undefined) return { _tag: 'Chosen', choice: { model: option.id, rung: asked.reasoning } };
  try {
    return { _tag: 'Chosen', choice: { model: row.spell({ model: option.id, rung: asked.reasoning }), rung: null } };
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : String(cause), [`name a model and rung ${row.label} serves together`]);
  }
}

export const resolvedAsked = (
  models: ModelCatalog,
  provider: string | null,
  asked: HarnessAskedModel | undefined,
): HarnessAskedModel | undefined => {
  const model = asked?.model ?? (provider !== null && models.registered(provider) ? models.defaultTextModelId(provider) : null);
  if (model === null) return undefined;
  const option = provider === null ? undefined : models.findTextModel(provider, model);
  if (asked === undefined && option === undefined) return undefined;
  return { model: option?.id ?? model, reasoning: asked?.reasoning ?? option?.defaultReasoning ?? null };
};

export const launchChoice = (
  models: ModelCatalog,
  adapter: HarnessAdapter,
  asked: HarnessAskedModel | undefined,
  transport: HarnessTransport = 'terminal',
): Effect.Effect<HarnessModelChoice | undefined, GateRefusal<'model-unavailable'>> => {
  const chosen = chosenModel(models, adapter, asked, transport);
  if (chosen._tag === 'Unavailable') return Effect.fail(new GateRefusal('model-unavailable', chosen.reason, chosen.unblock));
  return Effect.succeed(chosen._tag === 'None' ? undefined : chosen.choice);
};
