import { Effect } from 'effect';
import type { DynamicOperationFailure } from '../../invocation/contract/service/refusals.js';
import type { CallNeeds, OperationPerformer, OwnerContext, Performed } from '../../invocation/contract/service/performer.js';
import type { OperationId } from '../../platform/contract/wire/ids.js';
import { CallStanding, CurrentCaller, type ThreadStanding } from '../../invocation/contract/service/admission.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';

export type HttpPerformById = (
  id: OperationId,
  input: unknown,
  needs: CallNeeds,
) => Effect.Effect<Performed, DynamicOperationFailure, CurrentCaller | CallerWorkspace>;

export const httpPerformingById = <Owners>(
  performer: OperationPerformer['Service'],
  owners: OwnerContext<Owners, ThreadStanding | null>,
): HttpPerformById =>
  Effect.fnUntraced(function* (id: OperationId, input: unknown, needs: CallNeeds) {
    const site = { caller: yield* CurrentCaller, place: yield* CallerWorkspace, world: yield* CallStanding };
    return yield* performer.performByIdIn(owners)(id, input, site, needs);
  });
