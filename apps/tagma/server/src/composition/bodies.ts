import { Effect } from 'effect';
import type { Bound } from '../platform/contract/service/body.js';
import { bodiesOf, presentationsOf } from '../platform/contract/service/manifest.js';
import type { ModulePresentation } from '../platform/contract/service/presentation.js';
import { collectedOperations } from './manifest.js';

type AnyBound = Bound<any, any, any, any, any>;

export const operationBodies: Effect.Effect<Readonly<Record<string, AnyBound>>> = Effect.flatMap(collectedOperations, ({ modules }) =>
  Effect.map(Effect.forEach(modules, bodiesOf, { concurrency: 'unbounded' }), (loaded) =>
    Object.fromEntries(loaded.flat().map(({ id, body }) => [id, { ...body, id }])),
  ),
);

export const operationPresentations: Effect.Effect<ReadonlyMap<string, ModulePresentation<any>>> = Effect.flatMap(
  collectedOperations,
  ({ modules }) =>
    Effect.map(
      Effect.forEach(modules, presentationsOf, { concurrency: 'unbounded' }),
      (loaded) => new Map(loaded.flatMap((owned) => [...owned])),
    ),
);
