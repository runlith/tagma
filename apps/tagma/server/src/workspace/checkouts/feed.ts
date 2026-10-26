import { Effect, Stream } from 'effect';
import { refusing } from '../../platform/contract/service/body.js';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { CheckoutPlaces, CheckoutRows } from '../contract/service/checkouts.js';
import type { CheckoutState } from '../contract/wire/checkout.js';
import { projectRootRefusal } from '../roots/refusal.js';

export const checkoutChannel = (places: CheckoutPlaces['Service'], rows: CheckoutRows['Service']) => ({
  'checkout.subscribe': ({
    projectId,
    root,
    base,
  }: {
    readonly projectId: number;
    readonly root?: string;
    readonly base?: string;
  }): Stream.Stream<CheckoutState, RefusalBody> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const rootId = yield* refusing(places.rootOf({ projectId, cwd: undefined }, root));
        return Stream.catch(Stream.mapError(rows.subscribe(rootId, base), projectRootRefusal), (refusal) =>
          Stream.fromEffect(refusing(Effect.fail(refusal))),
        );
      }),
    ),
});
