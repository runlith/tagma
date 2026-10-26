import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { navigationCapability } from './contract/wire/capability.js';
import { navigation as declaration } from './contract/wire/module.js';
import { navigationEnabled, NAVIGATION_SETTING_SECTIONS } from './contract/wire/settings.js';
import { codeNavigation } from './doctrine/codeNavigation.js';

export const navigation = manifest({
  ...declaration,
  capabilities: [navigationCapability],
  sections: [
    {
      id: 'code-navigation',
      place: { prompt: 45 },
      owner: 'navigation',
      render: codeNavigation,
      path: 'src/navigation/doctrine/codeNavigation.ts',
    },
  ],
  settings: [navigationEnabled],
  settingSections: NAVIGATION_SETTING_SECTIONS,
  bodies: async () => Object.values((await import('./operations.js')).NAVIGATION_PAIRS),
  drivers: [{ id: 'navigation-sweep' }],
  lifetimes: {
    serving: lazyLayer(
      () => import('./holder.js'),
      ({ holderLayer }) => holderLayer,
    ),
  },
});
