import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Notifications } from './contract/service/notifications.js';
import { Senders } from './contract/service/senders.js';
import { NOTIFY_OPERATIONS as OPS, type NotifyOperationId } from './contract/wire/notification.js';

export const NOTIFY_PAIRS: { readonly [K in NotifyOperationId]: OperationPair<(typeof OPS)[K]> } = {
  send_notification: pair(
    OPS.send_notification,
    body(OPS.send_notification, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        if (caller.actor.kind !== 'external') {
          return yield* new GateRefusal('sender-required', 'a notification belongs to the external process that sends it', [
            'send it from an app process, which calls as app:<id>',
          ]);
        }
        if (!(yield* Senders).accepts(caller.actor.name)) {
          return yield* new GateRefusal('sender-required', `${caller.actor.name} declares no active notification receiver`, [
            'declare contributes.notify with its outcome tool and enable the app on this machine',
          ]);
        }
        const sent = yield* (yield* Notifications).send(caller.actor.name, {
          title: input.title,
          body: input.body ?? '',
          question: input.question ?? null,
          key: input.key,
        });
        return { status: 'sent' as const, id: sent.id, repeated: sent.repeated };
      }),
    }),
  ),
  answer_notification: pair(
    OPS.answer_notification,
    body(OPS.answer_notification, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'resolved' as const, ...(yield* (yield* Notifications).answer(input.id, input.value)) };
      }),
    }),
  ),
  dismiss_notification: pair(
    OPS.dismiss_notification,
    body(OPS.dismiss_notification, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'resolved' as const, ...(yield* (yield* Notifications).dismiss(input.id)) };
      }),
    }),
  ),
};
