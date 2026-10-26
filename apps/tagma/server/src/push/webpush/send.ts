import { Clock, Effect } from 'effect';
import webpush from 'web-push';
import type { Message, Sender, Sent, Target, Vapid } from '../contract/service/sender.js';

const DEADLINE_MS = 30_000;

const retryAfter = (header: string | null, now: number): number | null => {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
};

const answered = (response: Response, said: string, now: number): Sent => {
  const { status } = response;
  if (status >= 200 && status < 300) return { _tag: 'accepted' };
  if (status === 404 || status === 410) return { _tag: 'gone' };
  const reason = `the push service answered ${status}${said === '' ? '' : `: ${said.slice(0, 200)}`}`;
  if (status === 429 || status >= 500) return { _tag: 'later', afterMs: retryAfter(response.headers.get('retry-after'), now), reason };
  return { _tag: 'rejected', reason };
};

const said = (response: Response): Promise<string> =>
  response.text().then(
    (text) => text.trim(),
    (cause) => `its answer could not be read: ${String(cause)}`,
  );

async function delivered(target: Target, message: Message, vapid: Vapid, signal: AbortSignal, now: () => number): Promise<Sent> {
  let details: webpush.RequestDetails;
  try {
    details = webpush.generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      message.payload,
      { vapidDetails: vapid, TTL: message.ttlSeconds, urgency: message.urgency, contentEncoding: 'aes128gcm' },
    );
  } catch (cause) {
    return { _tag: 'rejected', reason: `the notification could not be encrypted for this subscription: ${String(cause)}` };
  }
  return fetch(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body,
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(DEADLINE_MS)]),
  }).then(
    async (response) => answered(response, await said(response), now()),
    (cause): Sent => ({ _tag: 'later', afterMs: null, reason: `the push service could not be reached: ${String(cause)}` }),
  );
}

export const webPushSender: Sender['Service'] = {
  send: Effect.fn('Sender.send')(function* (target, message, vapid) {
    const clock = yield* Clock.Clock;
    return yield* Effect.promise((signal) => delivered(target, message, vapid, signal, () => clock.currentTimeMillisUnsafe()));
  }),
};
