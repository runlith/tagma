import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import type { RootId } from '../contract/wire/ids.js';
import type { PlaceRefusal } from '../contract/wire/refusals.js';
import { type CheckoutAt, CheckoutPlaces, type CheckoutWriteFailure } from '../contract/service/checkouts.js';
import { rootReadRefusal } from '../roots/refusal.js';
import { CallerWorkspace } from '../contract/service/places.js';

export type CheckoutPlace =
  | { readonly at: CheckoutAt; readonly refusal: null }
  | { readonly at: null; readonly refusal: GateRefusal<PlaceRefusal> };

export const placeOf = Effect.fn('checkout.place')(function* (input: { readonly rootId: RootId }) {
  const call = yield* yield* CurrentProject;
  const place = yield* CallerWorkspace;
  const found = yield* Effect.result((yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: place?.root }, input.rootId));
  return found._tag === 'Success'
    ? ({
        at: { projectId: found.success.projectId, rootId: found.success.rootId, judged: found.success.path },
        refusal: null,
      } satisfies CheckoutPlace)
    : ({ at: null, refusal: found.failure } satisfies CheckoutPlace);
});

export const checkoutRefusal = (failure: CheckoutWriteFailure): GateRefusal =>
  failure._tag === 'CheckoutWriteRefused' ? new GateRefusal(failure.reason, failure.message, failure.unblock) : rootReadRefusal(failure);

export const standing = (place: CheckoutPlace): Effect.Effect<CheckoutAt, GateRefusal<PlaceRefusal>> =>
  place.at === null ? Effect.fail(place.refusal) : Effect.succeed(place.at);
