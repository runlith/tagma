import { Context, Effect, Layer } from 'effect';
import { ServedGraphs } from '../contract/service/serving.js';
import { type GraphPool, makeGraphPool } from './pool.js';
import { GraphRecoveries } from '../contract/service/recovery.js';

export class ServingPool extends Context.Service<ServingPool, GraphPool>()('tagma/graph/ServingPool') {}

export const graphPoolLayer = Layer.effectContext(
  Effect.map(makeGraphPool, (pool) =>
    Context.make(ServingPool, pool).pipe(Context.add(ServedGraphs, pool), Context.add(GraphRecoveries, pool.recoveries)),
  ),
);
