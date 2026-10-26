import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { pluginSecrets as declaration } from './contract/wire/module.js';

export const pluginSecrets = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).SECRET_PAIRS),
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ pluginSecretsLayer }) => pluginSecretsLayer,
    ),
  },
});
