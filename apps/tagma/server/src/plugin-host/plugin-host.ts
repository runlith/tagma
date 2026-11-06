import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { pluginHost as declaration } from './contract/wire/module.js';

export const pluginHost = manifest({
  ...declaration,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ pluginHostLayer }) => pluginHostLayer,
    ),
  },
});
