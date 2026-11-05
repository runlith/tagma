import { Context, Effect, FileSystem, Layer, PubSub, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import type { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import type { PluginFormats } from './contract/service/format.js';
import {
  EnabledPlugins,
  HostedPlugins,
  PluginPlaces,
  type PluginProcessReader,
  PluginProcesses,
  Plugins,
} from './contract/service/plugins.js';
import { PluginPoints } from './contract/service/points.js';
import { pluginsOptions } from './contract/wire/settings.js';
import { makeEnabled } from './enabled.js';
import { makeInstalls } from './installs.js';
import { makePoints } from './points.js';
import { makeShelf } from './shelf.js';
import { clearStaging } from './sources.js';

const UNHOSTED: PluginProcessReader = () => undefined;

export const pluginsLayer: Layer.Layer<
  Plugins | EnabledPlugins | HostedPlugins | PluginPoints | PluginProcesses,
  never,
  | Settings
  | Projects
  | ProjectChanges
  | SecretOwners
  | PluginPlaces
  | PluginFormats
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effectContext(
  Effect.gen(function* () {
    const { home } = yield* PluginPlaces;
    yield* clearStaging(home).pipe(Effect.orDie);
    const pulses = yield* Effect.acquireRelease(PubSub.unbounded<number | null>({ replay: 1 }), PubSub.shutdown);
    const changed = (projectId: number | null) => Effect.asVoid(PubSub.publish(pulses, projectId));
    const points = makePoints();
    let reader = UNHOSTED;
    const processes = PluginProcesses.of({
      register: (registered) =>
        Effect.sync(() => {
          reader = registered;
          return () => {
            if (reader === registered) reader = UNHOSTED;
          };
        }),
    });
    const shelf = yield* makeShelf({ home });
    const installs = yield* makeInstalls({ shelf, home, points, processes: () => reader, changed });
    const { enabled, hosted, owner } = yield* makeEnabled({ shelf, pulses });
    yield* Effect.acquireRelease((yield* SecretOwners).register(owner), (withdraw) => Effect.sync(withdraw));
    const options = yield* (yield* Settings).changes(pluginsOptions).pipe(Effect.orDie);
    yield* Effect.forkScoped(Stream.runForEach(Stream.drop(options, 1), () => changed(null)));
    const registry = yield* ProjectChanges;
    yield* Effect.acquireRelease(
      Effect.sync(() => [registry.removed.subscribe(() => changed(null)), registry.changed.subscribe(changed(null))]),
      (withdraw) => Effect.sync(() => withdraw.forEach((leave) => leave())),
    );
    return Context.make(Plugins, installs).pipe(
      Context.add(EnabledPlugins, enabled),
      Context.add(HostedPlugins, hosted),
      Context.add(PluginPoints, points),
      Context.add(PluginProcesses, processes),
    );
  }),
);
