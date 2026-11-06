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
  type PluginProcessControl,
  PluginProcesses,
  Plugins,
} from './contract/service/plugins.js';
import { PluginPoints } from './contract/service/points.js';
import { pluginsOptions } from './contract/wire/settings.js';
import { makeDigests } from './digests.js';
import { makeEnabled } from './enabled.js';
import { makeInstalls } from './installs.js';
import { makePoints } from './points.js';
import { makeShelf } from './shelf.js';
import { clearStaging } from './sources.js';

const UNHOSTED: PluginProcessControl = { reading: () => undefined, stopped: () => Effect.void };

type Options = Readonly<Record<string, Readonly<Record<string, string>>>>;

const differing = (before: Options, after: Options): readonly string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (id) => JSON.stringify(before[id] ?? {}) !== JSON.stringify(after[id] ?? {}),
  );

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
    const inputs = yield* Effect.acquireRelease(PubSub.unbounded<string>(), PubSub.shutdown);
    const touched = (id: string) => Effect.asVoid(PubSub.publish(inputs, id));
    const points = makePoints();
    let control = UNHOSTED;
    const processes = PluginProcesses.of({
      register: (registered) =>
        Effect.sync(() => {
          control = registered;
          return () => {
            if (control === registered) control = UNHOSTED;
          };
        }),
    });
    const shelf = yield* makeShelf({ home });
    const digests = yield* makeDigests;
    const installs = yield* makeInstalls({ shelf, digests, home, points, processes: () => control, changed, touched });
    const { enabled, hosted, owner } = yield* makeEnabled({ shelf, digests, pulses, inputs });
    yield* Effect.acquireRelease((yield* SecretOwners).register(owner), (withdraw) => Effect.sync(withdraw));
    const options = yield* (yield* Settings).changes(pluginsOptions).pipe(Effect.orDie);
    let seen: Options | null = null;
    yield* Effect.forkScoped(
      Stream.runForEach(options, (now) =>
        Effect.gen(function* () {
          const before = seen;
          seen = now;
          if (before === null) return;
          yield* Effect.forEach(differing(before, now), touched, { discard: true });
          yield* changed(null);
        }),
      ),
    );
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
