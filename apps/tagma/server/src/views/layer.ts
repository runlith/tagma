import { Context, Effect, Layer } from 'effect';
import type { SettingChanges } from '../settings/contract/service/changes.js';
import type { Settings } from '../settings/contract/service/values.js';
import { TagmaAppPoints } from '../tagma-apps/contract/service/points.js';
import type { TagmaApps } from '../tagma-apps/contract/service/supervision.js';
import type { TagmaAppTools } from '../tagma-apps/contract/service/tools.js';
import { LAUNCHERS, PANES, RESULTS, SURFACES, VIEWS } from './contract/service/points.js';
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
    const withdrawn = (withdraw: () => void) => Effect.sync(withdraw);
    yield* Effect.acquireRelease(points.declare(VIEWS, shelf.register.views), withdrawn);
    yield* Effect.acquireRelease(points.declare(RESULTS, shelf.register.results), withdrawn);
    yield* Effect.acquireRelease(points.declare(SURFACES, shelf.register.surfaces), withdrawn);
    yield* Effect.acquireRelease(points.declare(PANES, shelf.register.panes), withdrawn);
    yield* Effect.acquireRelease(points.declare(LAUNCHERS, shelf.register.launchers), withdrawn);
    return Context.make(TagmaAppViews, shelf).pipe(Context.add(ViewStorage, makeValues({ shelf })));
  }),
);
