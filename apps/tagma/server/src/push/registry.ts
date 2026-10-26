import { randomUUID } from 'node:crypto';
import { Clock, Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Subscriptions } from './contract/service/subscriptions.js';
import type { Subscription } from './contract/wire/push.js';
import type { Courier } from './courier.js';
import { Ledger } from './store/ledger.js';

const bytes = (text: string): number => (/^[A-Za-z0-9_-]+=*$/.test(text) ? Buffer.from(text, 'base64url').length : 0);

const https = (endpoint: string): boolean => URL.canParse(endpoint) && new URL(endpoint).protocol === 'https:';

const malformed = (subscription: Subscription): string | null =>
  !https(subscription.endpoint)
    ? 'the endpoint is not an https URL'
    : bytes(subscription.p256dh) !== 65
      ? 'p256dh is not a 65-byte P-256 public key in base64url'
      : bytes(subscription.auth) !== 16
        ? 'auth is not a 16-byte secret in base64url'
        : null;

export type Engine =
  | { readonly _tag: 'running'; readonly key: string; readonly courier: Courier }
  | { readonly _tag: 'off'; readonly reason: string };

export const makeRegistry = Effect.fnUntraced(function* ({ engine }: { readonly engine: Engine }) {
  const ledger = yield* Ledger;

  return Subscriptions.of({
    status: Effect.fnUntraced(function* (device) {
      const rows = yield* ledger.all;
      const mine = device === null ? undefined : rows.find((row) => row.deviceId === device);
      return {
        key: engine._tag === 'running' ? engine.key : null,
        endpoint: mine?.endpoint ?? null,
        problem: engine._tag === 'off' ? engine.reason : mine === undefined ? null : engine.courier.problemOf(mine.id),
        devices: rows.map((row) => row.deviceId),
      };
    }),
    subscribe: Effect.fn('Subscriptions.subscribe')(function* (device, subscription) {
      if (engine._tag === 'off') {
        return yield* new GateRefusal('push-unavailable', `push cannot run on this server: ${engine.reason}`, [
          'read read_push_status for the problem, fix the push key file it names and restart the server',
        ]);
      }
      const wrong = malformed(subscription);
      if (wrong !== null) {
        return yield* new GateRefusal('bad-subscription', `the push subscription cannot be used: ${wrong}`, [
          'pass PushSubscription.endpoint and the p256dh and auth keys of PushSubscription.toJSON() unchanged',
        ]);
      }
      return yield* ledger.put({
        id: randomUUID(),
        deviceId: device,
        ...subscription,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      });
    }),
    unsubscribe: (device) => ledger.remove({ deviceId: device }),
  });
});
