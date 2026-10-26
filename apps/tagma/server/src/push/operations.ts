import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Subscriptions } from './contract/service/subscriptions.js';
import { PUSH_OPERATIONS as OPS, type PushOperationId } from './contract/wire/push.js';

const deviceOf = (caller: Caller): string | null => (caller.actor.kind === 'operator' ? (caller.actor.deviceId ?? null) : null);

const paired = (caller: Caller) => {
  const device = deviceOf(caller);
  return device === null
    ? Effect.fail(
        new GateRefusal('device-required', 'notifications belong to a paired device, and this call came from none', [
          'turn notifications on from the Tagma page on the paired phone',
        ]),
      )
    : Effect.succeed(device);
};

export const PUSH_PAIRS: { readonly [K in PushOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_push_status: pair(
    OPS.read_push_status,
    body(OPS.read_push_status, {
      execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
        const device = deviceOf(caller);
        return { status: 'read' as const, ...(yield* (yield* Subscriptions).status(device)), device };
      }),
    }),
  ),
  subscribe_push: pair(
    OPS.subscribe_push,
    body(OPS.subscribe_push, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        yield* (yield* Subscriptions).subscribe(yield* paired(caller), input);
        return { status: 'subscribed' as const };
      }),
    }),
  ),
  unsubscribe_push: pair(
    OPS.unsubscribe_push,
    body(OPS.unsubscribe_push, {
      execute: Effect.fnUntraced(function* (_input, _prepared, caller) {
        yield* (yield* Subscriptions).unsubscribe(yield* paired(caller));
        return { status: 'unsubscribed' as const };
      }),
    }),
  ),
};
