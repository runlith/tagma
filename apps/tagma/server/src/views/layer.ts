import { Context, Effect, type FileSystem, Layer } from 'effect';
import type { PluginHost } from '../plugin-host/contract/service/supervision.js';
import type { PluginTools } from '../plugin-host/contract/service/tools.js';
import type { EnabledPlugins, HostedPlugins, PluginDigests, PluginFaults, Plugins } from '../plugins/contract/service/plugins.js';
import type { PluginPoints } from '../plugins/contract/service/points.js';
import { makeActions } from './actions.js';
import { PluginActions } from './contract/service/actions.js';
import { ViewCandidates, ViewFiles, type ViewPlaces, type WindowStyles } from './contract/service/places.js';
import { PluginViews, ViewStorage } from './contract/service/views.js';
import { makeShelf } from './shelf.js';
import { makeValues } from './storage.js';

export const viewsLayer: Layer.Layer<
  PluginViews | ViewStorage | PluginActions | ViewFiles | ViewCandidates,
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
    const acting = yield* makeActions({
      moves: shelf.moves,
      changed: shelf.bump,
      viewed: shelf.viewed,
      surfaces: shelf.surfaces,
      panes: shelf.panes,
    });
    return Context.make(PluginViews, shelf).pipe(
      Context.add(ViewStorage, makeValues({ shelf })),
      Context.add(PluginActions, acting.service),
      Context.add(ViewFiles, shelf.files),
      Context.add(ViewCandidates, shelf.candidates),
    );
  }),
);
