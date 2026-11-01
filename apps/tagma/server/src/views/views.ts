import { views as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { BRIDGE_METHODS } from './contract/service/bridge.js';
import { TagmaAppViews, ViewSites } from './contract/service/views.js';
import { HOST_BRIDGE } from './contract/wire/bridge.js';
import { VIEW_FEEDS } from './contract/wire/feeds.js';

const live: LiveDeclaration<typeof VIEW_FEEDS, TagmaAppViews | ViewSites> = liveOf(VIEW_FEEDS, async (door) =>
  (await import('./feeds.js')).viewChannels(Context.get(door, TagmaAppViews), Context.get(door, ViewSites)),
);

export const views = manifest({
  ...declaration,
  contributions: BRIDGE_METHODS.of(...HOST_BRIDGE),
  bodies: async () => Object.values((await import('./operations.js')).VIEW_PAIRS),
  live,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ viewsLayer }) => viewsLayer,
    ),
  },
});
