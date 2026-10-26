import { Context, Effect, Layer } from 'effect';
import type { Projects } from '../projects/contract/service/registry.js';
import type { Settings } from '../settings/contract/service/values.js';
import { PluginLaunches } from './contract/service/launch.js';
import { PluginPoints } from './contract/service/points.js';
import { type PluginPlace, Plugins } from './contract/service/supervision.js';
import { PluginTools } from './contract/service/tools.js';
import { makeInstalls } from './installs.js';
import { makeEnvironments } from './launches.js';
import { makeRegistry } from './registry.js';
import { makeSupervisor } from './supervisor.js';
import { makeOffers } from './toolPoint.js';

export const pluginsLayer: Layer.Layer<Plugins | PluginPoints | PluginTools | PluginLaunches, never, Settings | Projects | PluginPlace> =
  Layer.effectContext(
    Effect.gen(function* () {
      const registry = makeRegistry();
      const offers = yield* makeOffers;
      yield* registry.declare(offers.point);
      const launches = makeEnvironments();
      const supervisor = yield* makeSupervisor({ registry, launches });
      const installs = yield* makeInstalls({ registry, supervisor });
      return Context.make(Plugins, installs).pipe(
        Context.add(PluginPoints, registry),
        Context.add(PluginTools, offers),
        Context.add(PluginLaunches, { provide: launches.provide, changed: supervisor.changed }),
      );
    }),
  );
