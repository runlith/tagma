import { IMAGE_MODEL_AUTO, IMAGE_MODEL_OFF, imageModelChoice } from '@tagma/server/images/contract/wire/settings';
import type { Resolver } from '@runlith/layer/key';
import { pickerOrder } from '@runlith/llm/models/description';
import type { CatalogEntry } from '$lib/features/settings/controls/catalogs.js';
import { ProviderCatalog } from './Catalog.svelte.js';

export const imageModels = (app: Resolver): readonly CatalogEntry[] => [
  { value: IMAGE_MODEL_AUTO, label: 'Automatic', group: 'Default', swatches: [] },
  { value: IMAGE_MODEL_OFF, label: 'Off', group: 'Default', swatches: [] },
  ...pickerOrder([app.resolve(ProviderCatalog).models.providers]).flatMap((provider) =>
    Object.entries(provider.imageModels ?? {}).map(([model, spec]) => ({
      value: imageModelChoice(provider.id, model),
      label: spec.label,
      group: provider.label,
      swatches: [],
    })),
  ),
];
