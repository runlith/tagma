import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { socketOperationsLayer } from '../http/door.js';
import type { ServerRuntime } from '../runtime.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { doorServing, doorServicesOf } from './doorServices.js';
import { liveServing } from '../socketBinding.js';
import { ASSEMBLY } from './composed.js';
import type { Assembly } from '../manifest.js';

export const socketDoorLayer = (runtime: ServerRuntime, data: string) =>
  doorServing(socketOperationsLayer, runtime, data).pipe(
    Layer.provide(frozenBuildsLayer({ dataPath: data })),
    Layer.provide(Layer.succeedContext(routedContext(runtime.graph, runtime.pool))),
    Layer.provide(Layer.succeedContext(runtime.bindings)),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(BunFileSystem.layer),
  );

export const liveDoorLayer = (runtime: ServerRuntime, data: string, assembly: Assembly = ASSEMBLY) =>
  liveServing(assembly, null).pipe(
    Layer.provide(socketDoorLayer(runtime, data)),
    Layer.provide(Layer.effectContext(doorServicesOf(runtime, data))),
  );
