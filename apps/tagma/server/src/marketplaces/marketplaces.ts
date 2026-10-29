import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Marketplaces } from './contract/service/marketplaces.js';
import { marketplaces as declaration } from './contract/wire/module.js';
import { MARKETPLACE_FEEDS } from './contract/wire/rows.js';
import { MARKETPLACE_SETTING_SECTIONS, marketplacesAdded, marketplacesPresets } from './contract/wire/settings.js';

const live: LiveDeclaration<typeof MARKETPLACE_FEEDS, Marketplaces> = liveOf(MARKETPLACE_FEEDS, async (door) =>
  (await import('./feeds.js')).marketplaceChannels(Context.get(door, Marketplaces)),
);

export const marketplaces = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).MARKETPLACE_PAIRS),
  settings: [marketplacesAdded, marketplacesPresets],
  settingSections: MARKETPLACE_SETTING_SECTIONS,
  live,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ marketplacesLayer }) => marketplacesLayer,
    ),
  },
});
