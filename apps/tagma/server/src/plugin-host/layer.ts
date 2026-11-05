import { Context, Effect, Layer, Schedule, Semaphore, Stream } from 'effect';
import { LoadPluginTitles } from '../executions/contract/service/owners.js';
import { EnabledPlugins, HostedPlugins, PluginProcesses } from '../plugins/contract/service/plugins.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import { HostPlace, PluginHost } from './contract/service/supervision.js';
import { PluginTools, TOOLS } from './contract/service/tools.js';
import { makeSupervisor } from './supervisor.js';
import { makeOffers } from './toolPoint.js';

const ASKED_AGAIN = '5 seconds';

export const pluginHostLayer: Layer.Layer<
  PluginHost | PluginTools | LoadPluginTitles,
  never,
  HostPlace | PluginPoints | HostedPlugins | EnabledPlugins | PluginProcesses
> = Layer.effectContext(
  Effect.gen(function* () {
    const points = yield* PluginPoints;
    const hosted = yield* HostedPlugins;
    const enabled = yield* EnabledPlugins;
    const scope = yield* Effect.scope;
    const offers = yield* makeOffers;
    yield* Effect.acquireRelease(points.declare(TOOLS, offers.register), (withdraw) => Effect.sync(withdraw));
    const supervisor = yield* makeSupervisor({ points, hosted, offers });
    yield* Effect.acquireRelease((yield* PluginProcesses).register(supervisor.reading), (withdraw) => Effect.sync(withdraw));

    const serial = yield* Semaphore.make(1);

    const reconcile = Effect.fn('PluginHost.reconcile')(
      function* () {
        const roots = yield* hosted.roots();
        yield* Effect.forEach(
          supervisor.hosting().filter((id) => !roots.has(id)),
          (id) => supervisor.stop(id),
          { discard: true },
        );
        yield* Effect.forEach(roots, ([id, { root, projects }]) => supervisor.ensure(id, root, projects), {
          concurrency: 'unbounded',
          discard: true,
        });
      },
      (effect) => serial.withPermit(effect),
    );

    return Context.make(
      PluginHost,
      PluginHost.of({
        start: Effect.fn('PluginHost.start')(function* () {
          const settled = reconcile().pipe(Effect.retry(Schedule.spaced(ASKED_AGAIN)));
          yield* Effect.forkIn(
            Stream.runForEach(enabled.changes, () => settled),
            scope,
          );
          yield* reconcile().pipe(Effect.tapError(() => Effect.forkIn(settled, scope)));
        }),
        reading: supervisor.reading,
        pending: (id) => Effect.map(hosted.roots(), (roots) => roots.get(id)?.refused === null && !supervisor.standing(id)),
        call: supervisor.call,
        callAdmitted: supervisor.callAdmitted,
        read: supervisor.read,
        subscribe: supervisor.subscribe,
      }),
    ).pipe(Context.add(PluginTools, offers), Context.add(LoadPluginTitles, { read: () => Effect.sync(supervisor.titles) }));
  }),
);
