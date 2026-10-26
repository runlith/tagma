import { Effect } from 'effect';
import { operationRegistry as registryOf } from '../invocation/registry.js';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { projectedOperations } from '../platform/contract/wire/projection.js';
import { collectedOperations } from './manifest.js';

export const operationRegistry = Effect.runSync(
  Effect.cached(
    Effect.map(collectedOperations, ({ declarations }) =>
      registryOf<OperationId>(projectedOperations(Object.fromEntries(declarations.map((declaration) => [declaration.id, declaration])))),
    ),
  ),
);
