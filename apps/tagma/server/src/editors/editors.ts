import { editors as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { EDITOR_SETTING_SECTIONS, openIn } from './contract/wire/settings.js';

export const editors = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).EDITOR_PAIRS),
  settings: [openIn],
  settingSections: EDITOR_SETTING_SECTIONS,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ editorsLayer }) => editorsLayer,
    ),
  },
  drivers: [{ id: 'editors-search' }],
});
