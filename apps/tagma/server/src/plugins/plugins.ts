import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { pluginsCapability } from './contract/wire/capability.js';
import { plugins as declaration } from './contract/wire/module.js';
import {
  PLUGIN_SETTING_SECTIONS,
  pluginsDisabled,
  pluginsEnabled,
  pluginsInstalled,
  pluginsOff,
  pluginsOptions,
} from './contract/wire/settings.js';
import { plugins as pluginsSection } from './doctrine/plugins.js';

export const plugins = manifest({
  ...declaration,
  capabilities: [pluginsCapability],
  bodies: async () => Object.values((await import('./operations.js')).PLUGIN_PAIRS),
  settings: [pluginsInstalled, pluginsEnabled, pluginsDisabled, pluginsOff, pluginsOptions],
  settingSections: PLUGIN_SETTING_SECTIONS,
  sections: [{ id: 'plugins', place: { prompt: 210 }, owner: 'plugins', render: pluginsSection, path: 'src/plugins/doctrine/plugins.ts' }],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ pluginsLayer }) => pluginsLayer,
    ),
  },
});
