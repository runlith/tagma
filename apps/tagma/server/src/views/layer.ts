import { Context, Effect, Layer } from 'effect';
import type { SettingChanges } from '../settings/contract/service/changes.js';
import type { Settings } from '../settings/contract/service/values.js';
import { TagmaAppPoints } from '../tagma-apps/contract/service/points.js';
import type { TagmaApps } from '../tagma-apps/contract/service/supervision.js';
import type { TagmaAppTools } from '../tagma-apps/contract/service/tools.js';
import { TagmaAppViews, ViewStorage } from './contract/service/views.js';
import { makeShelf } from './shelf.js';
import { makeValues } from './storage.js';

export const viewsLayer: Layer.Layer<
  TagmaAppViews | ViewStorage,
  never,
  Settings | SettingChanges | TagmaApps | TagmaAppPoints | TagmaAppTools
> = Layer.effectContext(
  Effect.gen(function* () {
    const shelf = yield* makeShelf;
    const points = yield* TagmaAppPoints;
    yield* Effect.acquireRelease(points.declare(shelf.viewsPoint), (withdraw) => Effect.sync(withdraw));
    yield* Effect.acquireRelease(points.declare(shelf.resultsPoint), (withdraw) => Effect.sync(withdraw));
    yield* Effect.acquireRelease(points.declare(shelf.surfaces.point), (withdraw) => Effect.sync(withdraw));
    yield* Effect.acquireRelease(points.declare(shelf.panes.point), (withdraw) => Effect.sync(withdraw));
    yield* Effect.acquireRelease(points.declare(shelf.launchers.point), (withdraw) => Effect.sync(withdraw));
    return Context.make(TagmaAppViews, shelf).pipe(Context.add(ViewStorage, makeValues({ shelf })));
  }),
);
