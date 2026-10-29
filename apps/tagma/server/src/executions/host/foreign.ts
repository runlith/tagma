import { Effect, type FileSystem } from 'effect';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import type { Registration } from '@runlith/executions/protocol/registration';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import type { HostPlacement, OfferSource } from '../contract/service/host.js';
import type { HostArrival } from './arrival.js';
import type { StateClaim } from './boot.js';
import { hostBundleOwn, placeCandidate, withdrawCandidate } from './offer.js';

export type ForeignHost = {
  readonly _tag: 'Foreign';
  readonly placed: Extract<HostPlacement, { _tag: 'Placed' }>;
};

export type ForeignInput = {
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly source: OfferSource;
  readonly state: string;
  readonly claim: Effect.Effect<StateClaim>;
  readonly lifetime?: HostLifetime;
};

const registeredAt = (registrations: HostRegistration['Service'], state: string): Effect.Effect<Registered> =>
  Effect.match(registrations.read(state), {
    onFailure: (failure) => ({ _tag: 'Unread', detail: `the host registration at ${state} could not be read (${failure._tag})` }) as const,
    onSuccess: (registration) => ({ _tag: 'Read', registration }) as const,
  });

type Registered = { readonly _tag: 'Read'; readonly registration: Registration } | { readonly _tag: 'Unread'; readonly detail: string };

export const placeOverForeign = Effect.fnUntraced(function* (
  input: ForeignInput,
): Effect.fn.Return<HostPlacement | ForeignHost | undefined> {
  if ((yield* input.claim)._tag !== 'Held') return undefined;
  const registered = yield* registeredAt(input.registrations, input.state);
  if (registered._tag === 'Unread') return { _tag: 'Vacant', detail: registered.detail };
  const { logic, artifact } = registered.registration;
  if (logic === undefined || artifact === undefined) return undefined;
  const placed = yield* Effect.result(placeCandidate({ ...input, own: hostBundleOwn(input.state), restart: null }));
  if (placed._tag === 'Failure') {
    yield* Effect.logWarning('the standing host of another build could not be handed this build as a candidate', {
      detail: placed.failure.detail,
    });
    return undefined;
  }
  const placement = placed.success;
  if (placement._tag !== 'Placed') return placement;
  if (!placement.bundle) {
    yield* withdrawCandidate(input.files, input.state);
    return { _tag: 'Standing', digest: placement.digest, detail: placement.detail };
  }
  return { _tag: 'Foreign', placed: placement };
});

export const standingAfter = Effect.fnUntraced(function* (
  arrival: HostArrival,
  files: FileSystem.FileSystem,
  state: string,
): Effect.fn.Return<string | null> {
  switch (arrival._tag) {
    case 'Arrived':
    case 'Unheld':
      return null;
    case 'Refused':
      yield* withdrawCandidate(files, state);
      return `the standing host of another build refused this build's candidate and stays: ${arrival.detail}`;
    case 'Fallen':
      yield* withdrawCandidate(files, state);
      return `this build's host logic never came up, so no host serves this server: ${arrival.detail}`;
    case 'Kept':
      return `the standing host of another build stays: ${arrival.detail}`;
  }
});
