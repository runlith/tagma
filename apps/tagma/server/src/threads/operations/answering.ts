import { Effect, type Schema } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal, type FieldRefusal } from '../../platform/contract/wire/refusal.js';
import { type RefusalOf } from '../../platform/contract/service/body.js';
import { harnessRefusal } from '../refusals.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { THREAD_OPERATIONS, type ThreadOperationId } from '../contract/wire/operations/catalog.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';

export type AnswerOf<K extends ThreadOperationId> = (typeof THREAD_OPERATIONS)[K] extends { readonly answer: infer A extends Schema.Top }
  ? DeclaredAnswer<A>
  : never;

export const answering = <K extends ThreadOperationId, A, E extends HarnessFailure, R>(
  operation: K,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, GateRefusal<RefusalOf<(typeof THREAD_OPERATIONS)[K]> | FieldRefusal> | StoreFailure, R> =>
  harnessRefusal<A, E, R, RefusalOf<(typeof THREAD_OPERATIONS)[K]>>(work, THREAD_OPERATIONS[operation].refusals).pipe(
    Effect.catchTag('BodyMissing', (body) => Effect.fail(new GateRefusal('not-found', body.reason, body.unblock))),
  );
