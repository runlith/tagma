import { Layer } from 'effect';
import { tagmaApps as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { tagmaAppsCapability } from './contract/wire/capability.js';
import { TAGMA_APP_SETTING_SECTIONS, tagmaAppsEnabled, tagmaAppsInstalled } from './contract/wire/settings.js';
import { apps as appsSection } from './doctrine/apps.js';
import { toolNamesForm } from './steps/toolNames.js';

export const tagmaApps = manifest({
  ...declaration,
  capabilities: [tagmaAppsCapability],
  bodies: async () => Object.values((await import('./operations.js')).TAGMA_APP_PAIRS),
  settings: [tagmaAppsInstalled, tagmaAppsEnabled],
  settingSections: TAGMA_APP_SETTING_SECTIONS,
  sections: [{ id: 'apps', place: { prompt: 210 }, owner: 'tagma-apps', render: appsSection, path: 'src/tagma-apps/doctrine/apps.ts' }],
  formSteps: [toolNamesForm],
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./layer.js'), import('./steps/data.js')]),
      ([{ tagmaAppsLayer }, { dataMoved, secretsMoved }]) =>
        secretsMoved.pipe(Layer.provideMerge(tagmaAppsLayer), Layer.provide(dataMoved)),
    ),
  },
});
