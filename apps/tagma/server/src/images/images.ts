import { Layer } from 'effect';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { ImageChoice } from './contract/service/choice.js';
import { imagesCapability } from './contract/wire/capability.js';
import { images as declaration } from './contract/wire/module.js';
import { imageModel } from './contract/wire/settings.js';

export const images = manifest({
  ...declaration,
  capabilities: [imagesCapability],
  bodies: async () => Object.values((await import('./operations.js')).IMAGE_PAIRS),
  settings: [imageModel],
  lifetimes: {
    installation: lazyLayer(
      () => import('./choice.js'),
      ({ makeImageChoice }) => Layer.effect(ImageChoice, makeImageChoice),
    ),
  },
});
