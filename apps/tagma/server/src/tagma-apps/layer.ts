import { Context, Effect, Layer } from 'effect';
import { LoadAppTitles } from '../executions/contract/service/owners.js';
import type { Projects } from '../projects/contract/service/registry.js';
import { SecretOwners } from '../secrets/contract/service/secrets.js';
import type { Settings } from '../settings/contract/service/values.js';
import { TagmaAppLaunches } from './contract/service/launch.js';
import { TagmaAppPoints } from './contract/service/points.js';
import { type TagmaAppPlace, TagmaApps } from './contract/service/supervision.js';
import { TagmaAppTools, TOOLS } from './contract/service/tools.js';
import { makeInstalls } from './installs.js';
import { appTitles } from './loadTitles.js';
import { makeEnvironments } from './launches.js';
import { makeRegistry } from './registry.js';
import { makeShelf, SECRETS } from './secrets.js';
import { makeSupervisor } from './supervisor.js';
import { makeOffers } from './toolPoint.js';

export const tagmaAppsLayer: Layer.Layer<
  TagmaApps | TagmaAppPoints | TagmaAppTools | TagmaAppLaunches | LoadAppTitles,
  never,
  Settings | Projects | TagmaAppPlace | SecretOwners
> = Layer.effectContext(
  Effect.gen(function* () {
    const registry = makeRegistry();
    const offers = yield* makeOffers;
    yield* registry.declare(TOOLS, offers.register);
    const launches = makeEnvironments();
    const supervisor = yield* makeSupervisor({ registry, launches });
    const installs = yield* makeInstalls({ registry, supervisor });
    const shelf = yield* makeShelf({ apps: installs, supervisor });
    yield* registry.declare(SECRETS, shelf.register);
    yield* launches.provide(shelf.provide);
    yield* Effect.acquireRelease((yield* SecretOwners).register(shelf.owner), (withdraw) => Effect.sync(withdraw));
    return Context.make(TagmaApps, installs).pipe(
      Context.add(TagmaAppPoints, registry),
      Context.add(TagmaAppTools, offers),
      Context.add(TagmaAppLaunches, { provide: launches.provide, changed: supervisor.changed }),
      Context.add(LoadAppTitles, appTitles(installs)),
    );
  }),
);
