import { Context, Effect, type FileSystem, Layer } from 'effect';
import type { PluginHost } from '../plugin-host/contract/service/supervision.js';
import type { PluginTools } from '../plugin-host/contract/service/tools.js';
import type { EnabledPlugins, HostedPlugins, PluginDigests, PluginFaults, Plugins } from '../plugins/contract/service/plugins.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { makeActions } from './actions.js';
import { PluginActions } from './contract/service/actions.js';
import { ViewFiles, type ViewPlaces, type WindowStyles } from './contract/service/places.js';
import { PluginViews, ViewStorage } from './contract/service/views.js';
import { makeShelf } from './shelf.js';
import { makeValues } from './storage.js';

export const viewsLayer: Layer.Layer<
  PluginViews | ViewStorage | PluginActions | ViewFiles,
  never,
  | EnabledPlugins
  | HostedPlugins
  | Plugins
  | PluginHost
  | PluginPoints
  | PluginTools
  | PluginDigests
  | PluginFaults
  | ViewPlaces
  | WindowStyles
  | FileSystem.FileSystem
> = Layer.effectContext(
  Effect.gen(function* () {
    const shelf = yield* makeShelf;
    const points = yield* PluginPoints;
    const { views, results, surfaces, panes, launchers } = shelf.contributions;
    const acting = yield* makeActions({ moves: shelf.moves, changed: shelf.bump, viewed: shelf.viewed, surfaces, panes });
    const withdrawn = (withdraw: () => void) => Effect.sync(withdraw);
    yield* Effect.acquireRelease(points.declare(views.point, views.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(results.point, results.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(surfaces.point, surfaces.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(panes.point, panes.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(launchers.point, launchers.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(acting.contributions.actions.point, acting.contributions.actions.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(acting.contributions.shortcuts.point, acting.contributions.shortcuts.register), withdrawn);
    yield* Effect.acquireRelease(points.declare(acting.contributions.commands.point, acting.contributions.commands.register), withdrawn);
    return Context.make(PluginViews, shelf).pipe(
      Context.add(ViewStorage, makeValues({ shelf })),
      Context.add(PluginActions, acting.service),
      Context.add(ViewFiles, shelf.files),
    );
  }),
);
