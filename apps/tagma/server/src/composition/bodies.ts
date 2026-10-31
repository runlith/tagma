import { Effect } from 'effect';
import type { Bound } from '../platform/contract/service/body.js';
import { bodiesOf, type DeclaredOperations, presentationsOf } from '../platform/contract/service/manifest.js';
import type { ModulePresentation } from '../platform/contract/service/presentation.js';

type AnyBound = Bound<any, any, any, any, any>;

export const operationBodies = (modules: readonly DeclaredOperations[]): Effect.Effect<Readonly<Record<string, AnyBound>>> =>
  Effect.map(Effect.forEach(modules, bodiesOf, { concurrency: 'unbounded' }), (loaded) =>
    Object.fromEntries(loaded.flat().map(({ id, body }) => [id, { ...body, id }])),
  );

export const operationPresentations = (
  modules: readonly DeclaredOperations[],
): Effect.Effect<ReadonlyMap<string, ModulePresentation<any>>> =>
  Effect.map(
    Effect.forEach(modules, presentationsOf, { concurrency: 'unbounded' }),
    (loaded) => new Map(loaded.flatMap((owned) => [...owned])),
  );
