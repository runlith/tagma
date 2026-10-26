import { Cause, Clock, Effect, FiberMap, Stream } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { NotificationChange } from '../notify/contract/service/notifications.js';
import { Devices } from '../remote/contract/service/devices.js';
import type { AttentionChange } from '../threads/contract/service/attention.js';
import { Sender, type Vapid } from './contract/service/sender.js';
import { notificationTag } from './contract/wire/push.js';
import { type Alert, noticeOf, notificationAlert, threadAlert } from './notice.js';
import { type Delivery, Ledger } from './store/ledger.js';

export const KEPT_MS = 3_600_000;
const RETRIES_MS = [5_000, 30_000, 120_000, 300_000, 900_000] as const;
const TTL_SECONDS = 86_400;

type AlertChange =
  | { readonly _tag: 'all'; readonly alerts: readonly Alert[] }
  | { readonly _tag: 'put'; readonly alert: Alert }
  | { readonly _tag: 'gone'; readonly subject: string };

class Held {
  readonly alerts = new Map<string, Alert>();
  urgent = 0;

  hold(subject: string, alert: Alert | undefined): Alert | undefined {
    const prior = this.alerts.get(subject);
    if (prior?.counts === true) this.urgent -= 1;
    if (alert === undefined) this.alerts.delete(subject);
    else {
      this.alerts.set(subject, alert);
      if (alert.counts) this.urgent += 1;
    }
    return prior;
  }

  clear(): void {
    this.alerts.clear();
    this.urgent = 0;
  }
}

export const makeCourier = Effect.fnUntraced(function* ({ vapid }: { readonly vapid: Vapid }) {
  const ledger = yield* Ledger;
  const sender = yield* Sender;
  const devices = yield* Devices;
  const fibers = yield* FiberMap.make<string, void, StoreFailure>();

  const threads = new Held();

  const notifications = new Held();

  const problems = new Map<string, string>();

  const problemOf = (subscriptionId: string): string | null => problems.get(subscriptionId) ?? null;

  const followThreads = <E>(changes: Stream.Stream<AttentionChange, E>) =>
    Stream.runForEach(changes, (change) =>
      apply(
        threads,
        change._tag === 'all'
          ? { _tag: 'all', alerts: change.rows.map(threadAlert) }
          : change._tag === 'put'
            ? { _tag: 'put', alert: threadAlert(change.row) }
            : { _tag: 'gone', subject: change.threadId },
      ),
    );

  const followNotifications = <E>(changes: Stream.Stream<NotificationChange, E>) =>
    Stream.runForEach(changes, (change) =>
      apply(
        notifications,
        change._tag === 'all'
          ? { _tag: 'all', alerts: change.rows.map(notificationAlert) }
          : change._tag === 'put'
            ? { _tag: 'put', alert: notificationAlert(change.row) }
            : { _tag: 'gone', subject: notificationTag(change.id) },
      ),
    );

  const apply = (held: Held, change: AlertChange): Effect.Effect<void, StoreFailure> => {
    if (change._tag === 'gone') return Effect.sync(() => void held.hold(change.subject, undefined));
    if (change._tag === 'put') {
      const prior = held.hold(change.alert.subject, change.alert);
      return prior?.eventId === change.alert.eventId ? Effect.void : offer(change.alert);
    }
    held.clear();
    for (const alert of change.alerts) held.hold(alert.subject, alert);
    return Effect.forEach(change.alerts, (alert) => offer(alert), { discard: true });
  };

  const alertOf = (subject: string): Alert | undefined => threads.alerts.get(subject) ?? notifications.alerts.get(subject);

  const offer = Effect.fn('push.offer')(function* (alert: Alert) {
    if (!(alert.at > (yield* Clock.currentTimeMillis) - KEPT_MS)) return;
    for (const subscription of yield* ledger.all) {
      if (subscription.createdAt.getTime() > alert.at) continue;
      const delivery = { subscriptionId: subscription.id, subject: alert.subject, eventId: alert.eventId };
      yield* FiberMap.run(fibers, `${delivery.subscriptionId}|${delivery.subject}|${delivery.eventId}`, deliver(delivery), {
        onlyIfMissing: true,
      });
    }
  });

  const deliver = Effect.fn('push.deliver')(
    function* (delivery: Delivery) {
      for (let attempt = 0; ; attempt += 1) {
        const subscription = yield* ledger.byId(delivery.subscriptionId);
        if (subscription === undefined || (yield* ledger.sent(delivery))) return;
        if (!(yield* devices.paired(subscription.deviceId))) return yield* ledger.remove({ deviceId: subscription.deviceId });
        const alert = alertOf(delivery.subject);
        if (alert?.eventId !== delivery.eventId) return;
        const payload = noticeOf(alert, threads.urgent + notifications.urgent);
        if (payload === null) {
          problems.set(subscription.id, 'a notification does not fit the 3 KB a push service takes');
          return;
        }
        const message = { payload, ttlSeconds: TTL_SECONDS, urgency: alert.high ? 'high' : 'normal' } as const;
        const sent = yield* sender.send(subscription, message, vapid);
        if (sent._tag === 'accepted') {
          problems.delete(subscription.id);
          return yield* ledger.mark(delivery, new Date(yield* Clock.currentTimeMillis));
        }
        if (sent._tag === 'gone') {
          problems.delete(subscription.id);
          return yield* ledger.remove({ id: subscription.id });
        }
        const pause = sent._tag === 'later' && attempt < RETRIES_MS.length ? (sent.afterMs ?? RETRIES_MS[attempt]!) : undefined;
        if (pause === undefined || pause > KEPT_MS) {
          problems.set(subscription.id, sent.reason);
          return yield* Effect.logWarning('the push service did not take a notification', {
            subscription: subscription.id,
            reason: sent.reason,
          });
        }
        yield* Effect.sleep(pause);
      }
    },
    (work, delivery) =>
      work.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning('a push delivery stopped', { delivery, cause: Cause.pretty(cause) }),
        ),
      ),
  );

  return { problemOf, followThreads, followNotifications };
});

export type Courier = Effect.Success<ReturnType<typeof makeCourier>>;
