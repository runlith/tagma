import { Effect } from 'effect';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { harnessAdapter, servingProvider } from '../contract/service/table.js';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { HarnessName, HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { chosenModel, resolvedAsked } from './modelChoice.js';

export type NamedModel = { readonly provider?: string; readonly model?: string | null; readonly reasoning?: string | null };

export type AskedModel = (named: NamedModel | undefined) => Effect.Effect<HarnessAskedModel | undefined, HarnessFailure>;

export const launchedModel = (
  models: ModelCatalog,
  name: HarnessName,
  asked: HarnessAskedModel | undefined,
  preferred: NamedModel | null,
  transport: HarnessTransport = 'terminal',
): HarnessAskedModel | undefined => {
  if (asked !== undefined) return asked;
  const provider = servingProvider(name, transport);
  const model = preferred?.provider === provider ? (preferred?.model ?? null) : null;
  const own = model === null ? null : { model, reasoning: preferred?.reasoning ?? null };
  return own !== null && chosenModel(models, name, own, transport)._tag === 'Chosen' ? own : resolvedAsked(models, provider, undefined);
};

export function askedModelOf(
  models: ModelCatalog,
  name: HarnessName,
  named: NamedModel | undefined,
  transport: HarnessTransport = 'terminal',
): Effect.Effect<HarnessAskedModel | undefined, HarnessFailure> {
  const rung = named?.reasoning ?? null;
  const model = named?.model ?? null;
  if (named === undefined || model === null) {
    return rung === null
      ? Effect.succeed(undefined)
      : new GateRefusal(
          'model-unnamed',
          `The reasoning rung ${rung} names no model; a rung belongs to one model and is read against that model's own ladder.`,
          ['name the model the rung belongs to', 'start it without a rung'],
        );
  }
  const provider = servingProvider(name, transport);
  if (named.provider !== undefined && provider !== null && named.provider !== provider) {
    return new GateRefusal(
      'model-provider',
      `${harnessAdapter(name).label} serves the ${provider} row, not ${named.provider}; the same weights on another path are a different set with its own ceilings.`,
      [`name ${provider} as the provider`, "name no provider and take the harness row's own"],
    );
  }
  const asked: HarnessAskedModel = { model, reasoning: rung };
  const chosen = chosenModel(models, name, asked, transport);
  return chosen._tag === 'Unavailable' ? new GateRefusal('model-unavailable', chosen.reason, chosen.unblock) : Effect.succeed(asked);
}
