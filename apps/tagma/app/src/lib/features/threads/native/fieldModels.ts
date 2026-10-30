import { modelContextWindow } from '@runlith/llm/models/description';
import type { ModelOption } from '@runlith/llm/models/catalog';
import type { AskChoice, AskControl } from '@tagma/server/platform/contract/wire/setting';
import type { ServedModels } from '$lib/features/providers/served.js';
import { choiceKey, type ModelChoice, type ModelLead, windowWord } from '$lib/shared/models/choice.js';
import type { FavoritePair } from '$lib/shared/models/favorites.js';

export type FieldModels = {
  readonly choices: readonly ModelChoice[];
  readonly lead: readonly ModelLead[];
  readonly starred: readonly string[];
};

const answers = (models: ServedModels, option: ModelOption, ask: AskControl['of']): boolean =>
  (models.named(option.provider).asks[option.id] ?? []).includes(ask);

export function fieldModels(
  models: ServedModels,
  ask: AskControl['of'] | undefined,
  value: AskChoice | null,
  favorites: readonly FavoritePair[],
): FieldModels {
  const offered = models.providerOptions
    .filter((provider) => models.named(provider.id).selectable !== false)
    .flatMap((provider) =>
      ask === undefined
        ? models.modelsFor(provider.id, 'text')
        : models.modelsOf(provider.id).filter((option) => answers(models, option, ask)),
    );
  const built = ask === 'decision' ? offered.filter((option) => option.capabilities.includes('decision')) : [];
  const choices = [...built, ...offered.filter((option) => !built.includes(option))].map((option): ModelChoice => {
    const own = value !== null && value.provider === option.provider && value.model === option.id;
    return {
      provider: option.provider,
      providerLabel: models.providerLabel(option.provider),
      model: option.id,
      label: option.label,
      short: option.short,
      ladder: ask === undefined ? [] : option.reasoningOptions.map((step) => ({ id: step.id, label: step.label, short: step.short })),
      rung: ask === undefined ? null : ((own ? value.reasoning : null) ?? option.defaultReasoning),
      meta: windowWord(modelContextWindow(option.capacity)),
    };
  });
  const starred = favorites.map((pair) => choiceKey(pair.provider, pair.model));
  return {
    choices,
    starred,
    lead: [
      ...(built.length === 0
        ? []
        : [{ id: 'decision', label: 'Built for decisions', keys: built.map((one) => choiceKey(one.provider, one.id)) }]),
      { id: 'favorites', label: 'Favorites', starred: true, keys: starred },
    ],
  };
}
