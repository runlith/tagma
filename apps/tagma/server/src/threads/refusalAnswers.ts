import { Effect } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { GateRefusal, type FieldRefusal } from '../platform/contract/wire/refusal.js';
import type { HarnessFailure } from './contract/service/failure.js';
import { harnessRefusal } from './refusals.js';

type Declared<Code extends string> = { readonly refusals: readonly Code[] };

export const declaredRefusals =
  <Code extends string>(declaration: Declared<Code>) =>
  <A, R>(work: Effect.Effect<A, HarnessFailure, R>): Effect.Effect<A, GateRefusal<Code | FieldRefusal> | StoreFailure, R> =>
    harnessRefusal(work, declaration.refusals).pipe(
      Effect.catchTag('BodyMissing', (missing) => Effect.fail(new GateRefusal('not-found', missing.reason, missing.unblock))),
    );
