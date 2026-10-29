import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { secrets as declaration } from './contract/wire/module.js';

export const secrets = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).SECRET_PAIRS),
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ secretsLayer }) => secretsLayer,
    ),
  },
});
