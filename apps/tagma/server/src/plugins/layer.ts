import { Context, Effect, FileSystem, Layer, PubSub, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import type { PluginFormats } from './contract/service/format.js';
import { EnabledPlugins, PluginPlaces, Plugins } from './contract/service/plugins.js';
import { pluginsOptions } from './contract/wire/settings.js';
import { makeEnabled } from './enabled.js';
import { makeInstalls } from './installs.js';
import { makeShelf } from './shelf.js';
import { clearStaging } from './sources.js';

export const pluginsLayer: Layer.Layer<
  Plugins | EnabledPlugins,
  never,
  Settings | Projects | SecretOwners | PluginPlaces | PluginFormats | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effectContext(
  Effect.gen(function* () {
    const { home } = yield* PluginPlaces;
    yield* clearStaging(home).pipe(Effect.orDie);
    const pulses = yield* Effect.acquireRelease(PubSub.unbounded<number | null>(), PubSub.shutdown);
    const changed = (projectId: number | null) => Effect.asVoid(PubSub.publish(pulses, projectId));
    const shelf = yield* makeShelf({ home });
    const installs = yield* makeInstalls({ shelf, home, changed });
    const { enabled, owner } = yield* makeEnabled({ shelf, pulses });
    yield* Effect.acquireRelease((yield* SecretOwners).register(owner), (withdraw) => Effect.sync(withdraw));
    const options = yield* (yield* Settings).changes(pluginsOptions).pipe(Effect.orDie);
    yield* Effect.forkScoped(Stream.runForEach(Stream.drop(options, 1), () => changed(null)));
    return Context.make(Plugins, installs).pipe(Context.add(EnabledPlugins, enabled));
  }),
);
