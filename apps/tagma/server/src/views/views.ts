import { views as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { BRIDGE_METHODS } from './contract/service/bridge.js';
import { PluginActions } from './contract/service/actions.js';
import { PluginViews, ViewSites } from './contract/service/views.js';
import { HOST_BRIDGE } from './contract/wire/bridge.js';
import { VIEW_FEEDS } from './contract/wire/feeds.js';

const live: LiveDeclaration<typeof VIEW_FEEDS, PluginViews | ViewSites | PluginActions> = liveOf(VIEW_FEEDS, async (door) =>
  (await import('./feeds.js')).viewChannels(Context.get(door, PluginViews), Context.get(door, ViewSites), Context.get(door, PluginActions)),
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
