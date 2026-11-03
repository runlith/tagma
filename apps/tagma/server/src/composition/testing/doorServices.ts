import { join } from 'node:path';
import { Clock, Context, Effect, Layer } from 'effect';
import type { ServerRuntime } from '../runtime.js';
import { doorCompositionLayer, type DoorServices } from '../http/handlers.js';
import { successionLayer } from '../../installation/testing/doubles.js';
import { checkoutBuildsLayer } from '../../checkout-builds/testing/doubles.js';
import { ServerProcess } from '../../installation/contract/service/succession.js';

export const doorServicesOf = Effect.fnUntraced(function* (runtime: ServerRuntime, data: string) {
  const installed = yield* Layer.build(
    Layer.mergeAll(
      successionLayer(undefined, join(data, 'install'), join(data, 'serve.log'), (root) => join(root, 'desktop', 'carried')),
      checkoutBuildsLayer({ checkout: undefined, log: join(data, 'build.log'), worktrees: join(data, 'build') }),
    ),
  );
  const services: Context.Context<DoorServices> = Context.mergeAll(
    runtime.door,
    installed,
    Context.make(ServerProcess, {
      born: { startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(), replacedPid: null },
      source: runtime.status.source,
    }),
  );
  return services;
});

export const doorServing = <A, E, R>(door: Layer.Layer<A, E, R>, runtime: ServerRuntime, data: string) =>
  door.pipe(Layer.provide(doorCompositionLayer), Layer.provide(Layer.effectContext(doorServicesOf(runtime, data))));
