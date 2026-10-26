import { Cause, Clock, Effect, Layer, Schedule } from 'effect';
import { Notifications } from './contract/service/notifications.js';
import { Senders } from './contract/service/senders.js';
import { NotificationContributions } from './contract/service/contributions.js';
import { makeHandback } from './handback.js';
import { makeInbox } from './inbox.js';
import { Ledger, ledgerLayer } from './store/ledger.js';
import { drive } from '../platform/contract/service/drives.js';

export const KEPT_MS = 7 * 86_400_000;
const AGAIN = Schedule.spaced('10 seconds');

const again = <E>(what: string, work: Effect.Effect<void, E>) =>
  work.pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(`notify ${what} stopped and starts again`, Cause.pretty(cause)),
    ),
    Effect.retry(AGAIN),
  );

const kept = <E>(what: string, work: Effect.Effect<void, E>) => Effect.forkScoped(again(what, work));

export const notifyLayer = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const senders = yield* Senders;
    yield* Effect.acquireRelease(
      (yield* NotificationContributions).declare((sender, receiver) => senders.register(sender, receiver)),
      (withdraw) => Effect.sync(withdraw),
    );
    const handback = yield* makeHandback;
    yield* kept('resume', handback.resume());
    yield* drive(
      'notification-retention',
      again(
        'sweep',
        Effect.repeat(
          Effect.flatMap(Clock.currentTimeMillis, (now) => ledger.sweep(now - KEPT_MS)),
          Schedule.spaced('1 hour'),
        ),
      ),
    );
    return yield* makeInbox({ handback });
  }),
).pipe(Layer.provide(ledgerLayer));
