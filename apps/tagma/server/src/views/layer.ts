import { Context, Effect, Layer } from 'effect';
import type { PluginHost } from '../plugin-host/contract/service/supervision.js';
import type { PluginTools } from '../plugin-host/contract/service/tools.js';
import type { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { PluginViews, ViewStorage } from './contract/service/views.js';
import { makeShelf } from './shelf.js';
import { makeValues } from './storage.js';

export const viewsLayer: Layer.Layer<PluginViews | ViewStorage, never, EnabledPlugins | PluginHost | PluginPoints | PluginTools> =
  Layer.effectContext(
    Effect.gen(function* () {
      const shelf = yield* makeShelf;
      const points = yield* PluginPoints;
      const { views, results, surfaces, panes, launchers } = shelf.contributions;
      const withdrawn = (withdraw: () => void) => Effect.sync(withdraw);
      yield* Effect.acquireRelease(points.declare(views.point, views.register), withdrawn);
      yield* Effect.acquireRelease(points.declare(results.point, results.register), withdrawn);
      yield* Effect.acquireRelease(points.declare(surfaces.point, surfaces.register), withdrawn);
      yield* Effect.acquireRelease(points.declare(panes.point, panes.register), withdrawn);
      yield* Effect.acquireRelease(points.declare(launchers.point, launchers.register), withdrawn);
      return Context.make(PluginViews, shelf).pipe(Context.add(ViewStorage, makeValues({ shelf })));
    }),
  );
