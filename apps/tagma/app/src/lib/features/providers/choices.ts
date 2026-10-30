import { IMAGE_MODEL_AUTO, IMAGE_MODEL_OFF, imageModelChoice } from '@tagma/server/images/contract/wire/settings';
import { pickerOrder } from '@runlith/llm/models/description';
import type { CatalogEntry, ModelChoiceSet } from '$lib/features/settings/controls/catalogs.js';
import type { ServedModels } from './served.js';

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
  'image-model': imageModels,
};

export const modelChoices = (models: ServedModels, of: ModelChoiceSet): readonly CatalogEntry[] => CHOICES[of](models);
