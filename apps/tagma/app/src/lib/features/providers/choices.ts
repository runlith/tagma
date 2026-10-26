import { IMAGE_MODEL_AUTO, IMAGE_MODEL_OFF, imageModelChoice } from '@tagma/server/images/contract/wire/settings';
import { pickerOrder } from '@runlith/llm/models/description';
import type { ModelOption } from '@runlith/llm/models/catalog';
import type { CatalogEntry, ModelChoiceSet } from '$lib/features/settings/controls/catalogs.js';
import type { ServedModels } from './served.js';

const modelEntry = (model: ModelOption): CatalogEntry => ({
  value: model.key,
  label: model.label,
  group: model.providerLabel,
  swatches: [],
});

const textModels = (models: ServedModels): readonly CatalogEntry[] => [
  { value: '', label: 'Thread model', group: 'Default', swatches: [] },
  ...models.modelsByCapability('text').map(modelEntry),
];

const decisionModels = (models: ServedModels): readonly CatalogEntry[] => [
  { value: '', label: 'Automatic', group: 'Default', swatches: [] },
  ...models.modelsByCapability('decision').map(modelEntry),
  ...models
    .modelsByCapability('text')
    .filter((model) => !model.capabilities.includes('decision'))
    .map(modelEntry),
];

function reasoningRungs(models: ServedModels): readonly CatalogEntry[] {
  const rungs = new Map<string, CatalogEntry>([['', { value: '', label: 'Model default', group: 'Default', swatches: [] }]]);
  for (const model of models.options) {
    for (const rung of model.reasoningOptions) {
      if (!rungs.has(rung.id)) rungs.set(rung.id, { value: rung.id, label: rung.label, group: 'Reasoning', swatches: [] });
    }
  }
  return [...rungs.values()];
}

const imageModels = (models: ServedModels): readonly CatalogEntry[] => [
  { value: IMAGE_MODEL_AUTO, label: 'Automatic', group: 'Default', swatches: [] },
  { value: IMAGE_MODEL_OFF, label: 'Off', group: 'Default', swatches: [] },
  ...pickerOrder([models.providers]).flatMap((provider) =>
    Object.entries(provider.imageModels ?? {}).map(([model, spec]) => ({
      value: imageModelChoice(provider.id, model),
      label: spec.label,
      group: provider.label,
      swatches: [],
    })),
  ),
];

const CHOICES: Record<ModelChoiceSet, (models: ServedModels) => readonly CatalogEntry[]> = {
  model: textModels,
  'decision-model': decisionModels,
  reasoning: reasoningRungs,
  'image-model': imageModels,
};

export const modelChoices = (models: ServedModels, of: ModelChoiceSet): readonly CatalogEntry[] => CHOICES[of](models);
