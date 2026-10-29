import { Context, Effect, type FileSystem, Layer } from 'effect';
import type { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import type { Settings } from '../settings/contract/service/values.js';
import { PluginLaunches } from './contract/service/launch.js';
import { PluginPoints } from './contract/service/points.js';
import { PluginPlace, Plugins } from './contract/service/supervision.js';
import { PluginTools } from './contract/service/tools.js';
import { makeInstalls } from './installs.js';
import { makeEnvironments } from './launches.js';
import { makeRegistry } from './registry.js';
import { makeFormer, makeShelf } from './secrets.js';
import { makeSupervisor } from './supervisor.js';
import { makeOffers } from './toolPoint.js';

export const pluginsLayer: Layer.Layer<
  Plugins | PluginPoints | PluginTools | PluginLaunches,
  never,
  Settings | Projects | PluginPlace | SecretOwners | FileSystem.FileSystem
> = Layer.effectContext(
  Effect.gen(function* () {
    const registry = makeRegistry();
    const offers = yield* makeOffers;
    yield* registry.declare(offers.point);
    const launches = makeEnvironments();
    const supervisor = yield* makeSupervisor({ registry, launches });
    const former = yield* makeFormer({ home: (yield* PluginPlace).home });
    const installs = yield* makeInstalls({ registry, supervisor, former });
    const shelf = yield* makeShelf({ former, plugins: installs, supervisor });
    yield* registry.declare(shelf.point);
    yield* launches.provide(shelf.provide);
    yield* Effect.acquireRelease((yield* SecretOwners).register(shelf.owner), (withdraw) => Effect.sync(withdraw));
    return Context.make(Plugins, installs).pipe(
      Context.add(PluginPoints, registry),
      Context.add(PluginTools, offers),
      Context.add(PluginLaunches, { provide: launches.provide, changed: supervisor.changed }),
    );
  }),
);
