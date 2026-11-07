import { Context, Effect, FileSystem, Layer, PubSub, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import type { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { type PluginFormats, PluginUnreadable } from './contract/service/format.js';
import {
  BuiltinPlugins,
  EnabledPlugins,
  HostedPlugins,
  PluginDigests,
  PluginFaults,
  PluginPlaces,
  type PluginProcessControl,
  PluginProcesses,
  PluginRevisions,
  Plugins,
  ProviderParts,
  RevisionRecords,
} from './contract/service/plugins.js';
import { PluginPoints } from './contract/service/points.js';
import type { PluginFault } from './contract/wire/rows.js';
import { pluginsInstalled, pluginsOptions } from './contract/wire/settings.js';
import { makeDigests } from './digests.js';
import { makeEnabled } from './enabled.js';
import { makeInstalls } from './installs.js';
import { makeOutputs } from './outputs.js';
import { makePoints } from './points.js';
import { makeRevisions } from './revisions.js';
import { makeShelf } from './shelf.js';
import { clearStaging } from './sources.js';

const UNHOSTED: PluginProcessControl = { reading: () => undefined, stopped: () => Effect.void };

type Options = Readonly<Record<string, Readonly<Record<string, string>>>>;

const differing = (before: Options, after: Options): readonly string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (id) => JSON.stringify(before[id] ?? {}) !== JSON.stringify(after[id] ?? {}),
  );

export const pluginsLayer: Layer.Layer<
  | Plugins
  | EnabledPlugins
  | HostedPlugins
  | PluginPoints
  | PluginProcesses
  | PluginFaults
  | PluginDigests
  | ProviderParts
  | PluginRevisions,
  never,
  | Settings
  | Projects
  | ProjectChanges
  | SecretOwners
  | PluginPlaces
  | PluginFormats
  | BuiltinPlugins
  | RevisionRecords
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
    const found = new Map<string, Map<string, PluginFault>>();
    const placed = (plugin: string, point: string, fault: Omit<PluginFault, 'point'>): boolean => {
      const held = found.get(plugin) ?? new Map<string, PluginFault>();
      const standing = held.get(point);
      if (standing?.title === fault.title && standing.detail === fault.detail) return false;
      found.set(plugin, held.set(point, { point, ...fault }));
      return true;
    };
    const lifted = (plugin: string, point: string): boolean => {
      if (found.get(plugin)?.delete(point) !== true) return false;
      if (found.get(plugin)?.size === 0) found.delete(plugin);
      return true;
    };
    const faults = PluginFaults.of({
      put: (plugin, point, fault) => {
        if (placed(plugin, point, fault)) PubSub.publishUnsafe(pulses, null);
      },
      clear: (plugin, point) => {
        if (lifted(plugin, point)) PubSub.publishUnsafe(pulses, null);
      },
      replace: (point, next) => {
        let moved = false;
        for (const plugin of [...found.keys()]) if (!next.has(plugin) && lifted(plugin, point)) moved = true;
        for (const [plugin, fault] of next) if (placed(plugin, point, fault)) moved = true;
        if (moved) PubSub.publishUnsafe(pulses, null);
      },
    });
    const faultsOf = (id: string) => [...(found.get(id)?.values() ?? [])];
    const builtins = yield* BuiltinPlugins;
    const installs = yield* makeInstalls({
      shelf,
      digests,
      home,
      points,
      builtins,
      processes: () => control,
      changed,
      touched,
      faults: faultsOf,
    });
    const settings = yield* Settings;
    yield* makeOutputs({ shelf, installs: yield* settings.changes(pluginsInstalled).pipe(Effect.orDie), touched });
    const records = yield* RevisionRecords;
    const { parts, revisions } = yield* makeRevisions({
      home,
      shelf,
      digests,
      builtins,
      faults,
      settings,
      records,
      touched: Stream.fromPubSub(inputs),
    });
    const { enabled, hosted, owner } = yield* makeEnabled({ shelf, digests, points, pulses, inputs, parts });
    yield* Effect.acquireRelease((yield* SecretOwners).register(owner), (withdraw) => Effect.sync(withdraw));
    const options = yield* settings.changes(pluginsOptions).pipe(Effect.orDie);
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
      Context.add(PluginFaults, faults),
      Context.add(ProviderParts, parts),
      Context.add(PluginRevisions, revisions),
      Context.add(
        PluginDigests,
        PluginDigests.of({
          digest: (root, paths) =>
            digests
              .digest(root, paths, 'asked')
              .pipe(Effect.mapError((failure) => new PluginUnreadable({ path: root, reason: failure.reason }))),
        }),
      ),
    );
  }),
);
