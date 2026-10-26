import { join } from 'node:path';
import { Cause, Clock, Effect, Layer, Schedule, Stream } from 'effect';
import { dataPathOf, MachineStore } from '../platform/contract/service/store.js';
import { Notifications } from '../notify/contract/service/notifications.js';
import { Devices } from '../remote/contract/service/devices.js';
import { Attention } from '../threads/contract/service/attention.js';
import { Subscriptions } from './contract/service/subscriptions.js';
import { makeCourier, KEPT_MS } from './courier.js';
import { vapidAt } from './key.js';
import { makeRegistry } from './registry.js';
import { Ledger, ledgerLayer } from './store/ledger.js';
import { drive } from '../platform/contract/service/drives.js';

const AGAIN = Schedule.spaced('10 seconds');

const again = <E>(what: string, work: Effect.Effect<void, E>) =>
  work.pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(`push ${what} stopped and starts again`, Cause.pretty(cause)),
    ),
    Effect.retry(AGAIN),
  );

const kept = <E>(what: string, work: Effect.Effect<void, E>) => Effect.forkScoped(again(what, work));

export const pushLayer = Layer.effect(
  Subscriptions,
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const ledger = yield* Ledger;
    const data = dataPathOf(store.path);
    const key = vapidAt(data === null ? null : join(data, 'push.key'));
    const devices = yield* Devices;
    yield* kept(
      'revocation',
      Stream.runForEach(devices.revoked, ({ deviceId }) => ledger.remove({ deviceId })),
    );
    yield* drive(
      'push-retention',
      again(
        'sweep',
        Effect.repeat(
          Effect.flatMap(Clock.currentTimeMillis, (now) => ledger.sweep(new Date(now - KEPT_MS))),
          Schedule.spaced('10 minutes'),
        ),
      ),
    );
    return yield* Effect.matchEffect(key, {
      onFailure: Effect.fnUntraced(function* (failure) {
        yield* Effect.logError('push notifications are off: the push key cannot be read', failure.reason);
        return yield* makeRegistry({ engine: { _tag: 'off', reason: failure.reason } });
      }),
      onSuccess: Effect.fnUntraced(function* (vapid) {
        const courier = yield* makeCourier({ vapid });
        yield* kept('delivery', courier.followThreads((yield* Attention).changes));
        yield* kept('notification delivery', courier.followNotifications((yield* Notifications).changes));
        return yield* makeRegistry({ engine: { _tag: 'running', key: vapid.publicKey, courier } });
      }),
    });
  }),
).pipe(Layer.provide(ledgerLayer));
