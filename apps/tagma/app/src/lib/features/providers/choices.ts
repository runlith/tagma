import { IMAGE_MODEL_AUTO, IMAGE_MODEL_OFF, imageModelChoice } from '@tagma/server/images/contract/wire/settings';
import { Service } from '@runlith/layer/key';
import { pickerOrder } from '@runlith/llm/models/description';
import type { CatalogEntry, ChoiceSource } from '$lib/features/settings/controls/catalogs.js';
import { ProviderCatalog } from './Catalog.svelte.js';

export class ImageModels extends Service<ImageModels>()('ImageModels', { tier: 'app' }) implements ChoiceSource {
  static *make() {
    return new ImageModels(yield* ProviderCatalog);
  }

  constructor(private readonly catalog: ProviderCatalog) {
    super();
  }

  get entries(): readonly CatalogEntry[] {
    return [
      { value: IMAGE_MODEL_AUTO, label: 'Automatic', group: 'Default', swatches: [] },
      { value: IMAGE_MODEL_OFF, label: 'Off', group: 'Default', swatches: [] },
      ...pickerOrder([this.catalog.models.providers]).flatMap((provider) =>
        Object.entries(provider.imageModels ?? {}).map(([model, spec]) => ({
          value: imageModelChoice(provider.id, model),
          label: spec.label,
          group: provider.label,
          swatches: [],
        })),
      ),
    ];
  }
}
