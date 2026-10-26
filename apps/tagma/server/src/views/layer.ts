import { Context, Effect, Layer } from 'effect';
import { PluginPoints } from '../plugins/contract/service/points.js';
import type { Plugins } from '../plugins/contract/service/supervision.js';
import type { PluginTools } from '../plugins/contract/service/tools.js';
import type { SettingChanges } from '../settings/contract/service/changes.js';
import type { Settings } from '../settings/contract/service/values.js';
import { PluginViews, ViewStorage } from './contract/service/views.js';
import { makeShelf } from './shelf.js';
import { makeValues } from './storage.js';

export const viewsLayer: Layer.Layer<PluginViews | ViewStorage, never, Settings | SettingChanges | Plugins | PluginPoints | PluginTools> =
  Layer.effectContext(
    Effect.gen(function* () {
      const shelf = yield* makeShelf;
      const points = yield* PluginPoints;
      yield* Effect.acquireRelease(points.declare(shelf.viewsPoint), (withdraw) => Effect.sync(withdraw));
      yield* Effect.acquireRelease(points.declare(shelf.resultsPoint), (withdraw) => Effect.sync(withdraw));
      yield* Effect.acquireRelease(points.declare(shelf.surfaces.point), (withdraw) => Effect.sync(withdraw));
      yield* Effect.acquireRelease(points.declare(shelf.panes.point), (withdraw) => Effect.sync(withdraw));
      yield* Effect.acquireRelease(points.declare(shelf.launchers.point), (withdraw) => Effect.sync(withdraw));
      return Context.make(PluginViews, shelf).pipe(Context.add(ViewStorage, makeValues({ shelf })));
    }),
  );
