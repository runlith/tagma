import { Effect, Layer } from 'effect';
import { PluginLaunches } from '../plugins/contract/service/launch.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { PluginPlace, Plugins } from '../plugins/contract/service/supervision.js';
import { PluginSecrets } from './contract/service/secrets.js';
import { makeShelf } from './shelf.js';
import { makeStore } from './store.js';

export const pluginSecretsLayer: Layer.Layer<PluginSecrets, never, Plugins | PluginPoints | PluginLaunches | PluginPlace> = Layer.effect(
  PluginSecrets,
  Effect.gen(function* () {
    const { home } = yield* PluginPlace;
    const shelf = yield* makeShelf({ store: home === null ? null : makeStore({ home }) });
    yield* Effect.acquireRelease((yield* PluginPoints).declare(shelf.point), (withdraw) => Effect.sync(withdraw));
    yield* Effect.acquireRelease((yield* PluginLaunches).provide(shelf.provide), (withdraw) => Effect.sync(withdraw));
    return shelf;
  }),
);
