import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { pluginsCapability } from './contract/wire/capability.js';
import { plugins as declaration } from './contract/wire/module.js';
import { PLUGIN_SETTING_SECTIONS, pluginsEnabled, pluginsInstalled, pluginsOptions } from './contract/wire/settings.js';

export const plugins = manifest({
  ...declaration,
  capabilities: [pluginsCapability],
  bodies: async () => Object.values((await import('./operations.js')).PLUGIN_PAIRS),
  settings: [pluginsInstalled, pluginsEnabled, pluginsOptions],
  settingSections: PLUGIN_SETTING_SECTIONS,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ pluginsLayer }) => pluginsLayer,
    ),
  },
});
