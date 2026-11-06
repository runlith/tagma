import { views as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { VIEW_CAPABILITIES } from './contract/service/capabilities.js';
import { PluginActions } from './contract/service/actions.js';
import { PluginViews } from './contract/service/views.js';
import { TAGMA_VIEW } from './contract/wire/capabilities.js';
import { VIEW_FEEDS } from './contract/wire/feeds.js';
import { VIEW_ROUTES } from './modules/routes.js';

const live: LiveDeclaration<typeof VIEW_FEEDS, PluginViews | PluginActions> = liveOf(VIEW_FEEDS, async (door) =>
  (await import('./feeds.js')).viewChannels(Context.get(door, PluginViews), Context.get(door, PluginActions)),
);

export const views = manifest({
  ...declaration,
  contributions: VIEW_CAPABILITIES.of(...TAGMA_VIEW),
  bodies: async () => Object.values((await import('./operations.js')).VIEW_PAIRS),
  routes: VIEW_ROUTES,
  live,
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ viewsLayer }) => viewsLayer,
    ),
  },
});
