import { Effect } from 'effect';
import type { ModelCatalog, ModelOption } from '@runlith/llm/models/catalog';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadModelSelection, ThreadRecord } from '../thread/record';
import type { ThreadCallBroke } from '../thread/ThreadBorder';
import { causeSentence } from '../thread/persisted';
import { planeRefused } from './planeRefusal';
import type { ThreadModelAsk, ThreadSpawnResult } from './ThreadPlaneAccess';
import type { ThreadTypeOffer } from './types';
import type { AgentProfile } from '../thread/agents/AgentProfile';

export type ModelJudgment = {
  readonly option: ModelOption;
  readonly reasoning: string | null;
  readonly lowered?: ThreadSpawnResult['lowered'];
};

function loweredSelection(
  source: { readonly model?: string | null; readonly reasoning?: string | null },
  option: ModelOption,
  reasoning: string | null,
): ThreadSpawnResult['lowered'] {
  const lowered = {
    ...(source.model && source.model !== option.id ? { model: source.model } : {}),
    ...(source.reasoning && source.reasoning !== reasoning ? { reasoning: source.reasoning } : {}),
  };
  return Object.keys(lowered).length === 0 ? undefined : lowered;
}

type Unserved = {
  readonly offered: ModelCatalog;
  readonly model: string | null;
  readonly omit: string | null;
};

const BIRTH_OMIT = 'omit them, and the child inherits yours';

const NEAREST = 3;

function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const swap = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(Math.min(previous[column]! + 1, current[column - 1]! + 1, swap));
    }
    previous = current;
  }
  return previous[right.length]!;
}

function nearest(asked: string | null, options: readonly ModelOption[]): readonly ModelOption[] {
  if (asked === null) return options;
  return [...options].sort((left, right) => distance(asked, left.id) - distance(asked, right.id)).slice(0, NEAREST);
}

function unservedWays(provider: string, unserved: Unserved): readonly [string, ...string[]] {
  const text = unserved.offered.modelsByCapability('text');
  const label = (option: ModelOption) => (option.operatorOnly ? `${option.id} (operator-only)` : option.id);
  const elsewhere = [
    ...new Set(text.filter((option) => option.id === unserved.model && option.provider !== provider).map((option) => option.provider)),
  ];
  const own = text.filter((option) => option.provider === provider);
  const named =
    elsewhere.length > 0
      ? `name the provider that serves ${unserved.model}: ${elsewhere.join(', ')}`
      : own.length > 0
        ? `name a model ${provider} serves${unserved.model === null ? '' : ', nearest first'}: ${nearest(unserved.model, own).map(label).join(', ')}`
        : `name a provider a child may run on: ${[...new Set(text.map((option) => option.provider))].join(', ')}`;
  return unserved.omit === null ? [named] : [named, unserved.omit];
}

function served<A>(provider: string, unserved: Unserved, resolve: () => A): Effect.Effect<A, ThreadCallBroke> {
  return Effect.try({
    try: resolve,
    catch: (cause) => planeRefused('model-unserved', causeSentence(cause), unservedWays(provider, unserved)),
  });
}

const judgedModel = Effect.fnUntraced(function* (
  models: ModelCatalog,
  input: {
    readonly provider: string;
    readonly model: string | null;
    readonly asked: string | null | undefined;
    readonly source: string | null;
    readonly named: boolean;
    readonly unserved: Unserved;
  },
): Effect.fn.Return<ModelJudgment, ThreadCallBroke> {
  const option = yield* served(input.provider, input.unserved, () => models.resolveTextModel(input.provider, input.model));
  const asked = input.asked;
  if (asked !== undefined && asked !== null && !option.reasoningOptions.some((level) => level.id === asked)) {
    const offered = option.reasoningOptions.map((level) => level.id).join(', ') || 'none';
    const pair = `${option.provider}/${option.id}`;
    return yield* planeRefused(
      'reasoning-unoffered',
      `${pair} offers reasoning: ${offered}.`,
      option.reasoningOptions.length === 0 ? ['omit `reasoning`'] : [`name a rung ${pair} offers: ${offered}`, 'omit `reasoning`'],
    );
  }
  const reasoning = models.spawnReasoning(option, input.source, input.named);
  const lowered = loweredSelection({ reasoning: input.source }, option, reasoning);
  return { option, reasoning, lowered: lowered };
});

export const profileModel = Effect.fnUntraced(function* (
  models: ModelCatalog,
  standing: ThreadModelSelection | null,
  profile: AgentProfile | null,
): Effect.fn.Return<ModelJudgment | null, ThreadCallBroke> {
  if (!profile?.model) return null;
  const provider = profile.model.provider ?? standing?.provider;
  if (provider === undefined) return null;
  const model =
    profile.model.model !== undefined ? profile.model.model : provider === standing?.provider ? (standing?.model ?? null) : null;
  const option = yield* served(provider, { offered: models, model, omit: null }, () => models.resolveTextModel(provider, model));
  const sourceReasoning = profile.model.reasoning !== undefined ? profile.model.reasoning : (standing?.reasoning ?? null);
  const reasoning = models.spawnReasoning(option, sourceReasoning, profile.model.reasoning !== undefined);
  const lowered = loweredSelection({ reasoning: sourceReasoning }, option, reasoning);
  return { option, reasoning, lowered: lowered };
});

export const birthModel = Effect.fnUntraced(function* (
  models: ModelCatalog,
  parent: ThreadRecord,
  offer: ThreadTypeOffer,
  asked: ThreadModelAsk | undefined,
  offered: ModelCatalog = models,
): Effect.fn.Return<ModelJudgment | null, ThreadCallBroke> {
  const profile = offer.profile ?? null;
  const standing = parent.model;
  if (asked && (asked.provider ?? asked.model ?? asked.reasoning) !== undefined) {
    const rung = asked.reasoning;
    const profileReasoning = profile?.model?.reasoning;
    const provider = asked.provider ?? profile?.model?.provider ?? standing?.provider;
    if (provider === undefined) return yield* planeRefused('model-unnamed', 'name the provider of the model to start on.');
    const profiled = provider === (profile?.model?.provider ?? standing?.provider) ? profile?.model?.model : undefined;
    const model = asked.model ?? profiled;
    const unserved = { offered, model: model ?? null, omit: BIRTH_OMIT };
    if (asked.provider !== undefined && !offered.modelsByCapability('text').some((option) => option.provider === asked.provider)) {
      return yield* planeRefused(
        'model-unserved',
        `${asked.provider} is not offered to this thread’s children.`,
        unservedWays(asked.provider, unserved),
      );
    }
    const inherited =
      model === undefined
        ? yield* served(provider, unserved, () => {
            const source = provider === standing?.provider ? standing.model : models.defaultTextModelId(provider);
            return { source, option: models.spawnInherits(provider, source) };
          })
        : null;
    const judgment = yield* judgedModel(models, {
      provider,
      model: inherited?.option.id ?? model ?? null,
      asked: rung,
      source: rung !== undefined ? rung : profileReasoning !== undefined ? profileReasoning : (standing?.reasoning ?? null),
      named: rung !== undefined || profileReasoning !== undefined,
      unserved,
    });
    return inherited !== null && inherited.source !== inherited.option.id
      ? { ...judgment, lowered: { ...judgment.lowered, model: inherited.source } }
      : judgment;
  }
  if (profile?.model) return yield* profileModel(models, standing, profile);
  if (standing === null) return null;
  const option = yield* served(standing.provider, { offered: models, model: standing.model, omit: null }, () =>
    models.spawnInherits(standing.provider, standing.model),
  );
  const reasoning = models.spawnReasoning(option, standing.reasoning, false);
  const lowered = loweredSelection({ model: standing.model, reasoning: standing.reasoning }, option, reasoning);
  return { option, reasoning, lowered: lowered };
});

export const askedSwitches = Effect.fnUntraced(function* (
  option: ModelOption,
  asked: ModelSwitches | undefined,
): Effect.fn.Return<ModelSwitches, ThreadCallBroke> {
  for (const [id, value] of Object.entries(asked ?? {})) {
    const declared = option.switches.find((offered) => offered.id === id);
    if (declared === undefined) {
      const offered = option.switches.map((one) => one.id).join(', ') || 'none';
      return yield* planeRefused('switch-unoffered', `${option.provider}/${option.id} offers switches: ${offered}.`);
    }
    if (!declared.values.some((one) => one.id === value)) {
      const values = declared.values.map((one) => one.id).join(', ');
      return yield* planeRefused('switch-unoffered', `${id} on ${option.provider}/${option.id} takes: ${values}.`);
    }
  }
  return asked ?? {};
});

export const movedModel = Effect.fnUntraced(function* (
  models: ModelCatalog,
  current: ThreadModelSelection,
  asked: ThreadModelAsk,
): Effect.fn.Return<ModelJudgment, ThreadCallBroke> {
  const provider = asked.provider ?? current.provider;
  const unserved = {
    offered: models,
    model: asked.model ?? null,
    omit: 'omit `model`, and the child keeps its own or takes the provider’s default',
  };
  const defaulted =
    asked.model === undefined && provider !== current.provider
      ? yield* served(provider, unserved, () => {
          const declaredDefault = models.defaultTextModelId(provider);
          return { declaredDefault, inherited: models.spawnInherits(provider, declaredDefault).id };
        })
      : null;
  const judgment = yield* judgedModel(models, {
    provider,
    model: asked.model ?? defaulted?.inherited ?? current.model,
    asked: asked.reasoning,
    source: asked.reasoning !== undefined ? asked.reasoning : current.reasoning,
    named: asked.reasoning !== undefined,
    unserved,
  });
  return defaulted !== null && defaulted.declaredDefault !== defaulted.inherited
    ? { ...judgment, lowered: { ...judgment.lowered, model: defaulted.declaredDefault } }
    : judgment;
});
