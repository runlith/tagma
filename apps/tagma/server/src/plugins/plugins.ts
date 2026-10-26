import { plugins as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { pluginsCapability } from './contract/wire/capability.js';
import { PLUGIN_SETTING_SECTIONS, pluginsEnabled, pluginsInstalled } from './contract/wire/settings.js';
import { plugins as pluginsSection } from './doctrine/plugins.js';

export const plugins = manifest({
  ...declaration,
  capabilities: [pluginsCapability],
  bodies: async () => Object.values((await import('./operations.js')).PLUGIN_PAIRS),
  settings: [pluginsInstalled, pluginsEnabled],
  settingSections: PLUGIN_SETTING_SECTIONS,
  sections: [{ id: 'plugins', place: { prompt: 210 }, owner: 'plugins', render: pluginsSection, path: 'src/plugins/doctrine/plugins.ts' }],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ pluginsLayer }) => pluginsLayer,
    ),
  },
});
