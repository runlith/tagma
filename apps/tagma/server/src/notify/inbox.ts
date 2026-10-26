import { randomUUID } from 'node:crypto';
import { Clock, Effect, PubSub, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { type NotificationChange, Notifications, type Resolved, type Sent } from './contract/service/notifications.js';
import { OPEN_PER_SENDER } from './contract/wire/notification.js';
import type { Handback } from './handback.js';
import { Ledger, notificationOf, outcomeOf, type Row } from './store/ledger.js';

const gone = (id: string) =>
  new GateRefusal('not-found', `no notification is named ${id}`, ['a settled notification is kept for a week and then forgotten']);

export const makeInbox = Effect.fnUntraced(function* ({ handback }: { readonly handback: Handback }) {
  const ledger = yield* Ledger;
  const published = yield* PubSub.unbounded<NotificationChange>();

  const settle = Effect.fn('Notifications.settle')(function* (id: string, kind: 'answered' | 'dismissed', answer: string | null) {
    const at = yield* Clock.currentTimeMillis;
    const ended = yield* Effect.uninterruptible(
      Effect.tap(ledger.end(id, { kind, answer, at }), (row) =>
        row === undefined ? Effect.void : Effect.andThen(PubSub.publish(published, { _tag: 'gone', id }), handback.hand(id)),
      ),
    );
    const outcome = ended === undefined ? null : outcomeOf(ended);
    if (outcome !== null) return { id, outcome, repeated: false } satisfies Resolved;
    const current = yield* ledger.byId(id);
    const standing = current === undefined ? null : outcomeOf(current);
    if (standing === null) return yield* gone(id);
    return { id, outcome: standing, repeated: true } satisfies Resolved;
  });

  return Notifications.of({
    changes: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(published);
        const rows = yield* ledger.open;
        const first: NotificationChange = { _tag: 'all', rows: rows.map(notificationOf) };
        return Stream.concat(Stream.make(first), Stream.fromSubscription(subscription));
      }),
    ),
    send: Effect.fn('Notifications.send')(function* (sender, draft) {
      const row: Row = {
        id: randomUUID(),
        sender,
        key: draft.key ?? null,
        title: draft.title,
        body: draft.body,
        questionText: draft.question?.text ?? null,
        questionOptions: draft.question === null ? null : [...draft.question.options],
        createdAt: yield* Clock.currentTimeMillis,
        endedAt: null,
        outcome: null,
        answer: null,
        deliveredAt: null,
      };
      const sent = notificationOf(row);
      const inserted = yield* Effect.uninterruptible(
        Effect.tap(ledger.insert(row, OPEN_PER_SENDER), (insertion) =>
          insertion._tag === 'stored' ? PubSub.publish(published, { _tag: 'put', row: sent }) : Effect.void,
        ),
      );
      if (inserted._tag === 'existing') return { ...notificationOf(inserted.row), repeated: true } satisfies Sent;
      if (inserted._tag === 'full') {
        return yield* new GateRefusal('too-many-open', `${sender} already holds ${OPEN_PER_SENDER} open notifications`, [
          'wait until the operator answers or dismisses some, then send again',
        ]);
      }
      return { ...sent, repeated: false } satisfies Sent;
    }),
    answer: Effect.fn('Notifications.answer')(function* (id, answer) {
      const row = yield* ledger.byId(id);
      if (row === undefined) return yield* gone(id);
      if (row.endedAt === null) {
        if (row.questionText === null) {
          return yield* new GateRefusal('no-question', 'this notification asks nothing, so it can only be dismissed', [
            'call dismiss_notification',
          ]);
        }
        const options = row.questionOptions ?? [];
        if (options.length > 0 && !options.includes(answer)) {
          return yield* new GateRefusal('bad-answer', `the answer is none of the options: ${options.join(' | ')}`, [
            'answer with one of the options, written exactly',
          ]);
        }
      }
      return yield* settle(id, 'answered', answer);
    }),
    dismiss: (id) => settle(id, 'dismissed', null),
  });
});
