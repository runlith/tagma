import { Effect } from 'effect';
import { page, pageRows, pastKey, readCursor, type PageKey, type PageQuestion } from '@runlith/paging';
import { PLANE_REFUSALS } from '@runlith/agent/collaboration/refusals';
import type { ThreadPlaneMessaging } from '@runlith/agent/collaboration/ThreadPlaneAccess';
import { threadTarget, type ThreadRecord } from '@runlith/agent/thread/record';
import { body, pair, type OperationPair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { ThreadSubscriptions, type ThreadSubscription } from '../contract/service/subscriptions.js';
import { SUBSCRIPTION_OPERATIONS as OPS, SUBSCRIPTIONS } from '../contract/wire/operations/subscriptions.js';
import { nowOf } from '../subscriptions/lines.js';
import { callingThread, collaborating } from './collaboration.js';

const QUESTION: PageQuestion = { operation: 'read_subscriptions', selection: {}, order: SUBSCRIPTIONS.order };

const ORDER = ['asc', 'asc'] as const;

const keyOf = (row: ThreadSubscription): PageKey => [row.createdAt.getTime(), row.targetId];

const SELF: Unblock = ['subscribe to other threads: what your own thread does reaches you already'];

const followed = (thread: ThreadRecord) => ({ ...threadTarget(thread), name: thread.name });

const standing = Effect.fnUntraced(function* (ids: readonly string[]) {
  const summaries =
    ids.length === 0
      ? []
      : yield* (yield* ThreadLookup).summaries(ids).pipe(Effect.catchTag('ThreadStorageFailed', (failure) => Effect.die(failure)));
  const now = new Map(summaries.map((summary) => [summary.id, nowOf(summary)]));
  return (id: string) => now.get(id) ?? null;
});

const addressed = (messaging: ThreadPlaneMessaging, addresses: readonly string[]) =>
  Effect.flatMap(messaging.recipients(addresses), (found) =>
    'addressable' in found
      ? Effect.fail(
          new GateRefusal(
            'thread-unknown',
            `no thread you can address answers to ${found.addresses.join(', ')}` +
              (found.addressable.length === 0 ? '.' : `; your team answers to ${found.addressable.join(', ')}.`),
            PLANE_REFUSALS['thread-unknown'],
          ),
        )
      : Effect.succeed(found.recipients),
  );

const named = Effect.fnUntraced(function* (messaging: ThreadPlaneMessaging, ids: readonly string[]) {
  const found = yield* messaging.recipients(ids);
  if (!('addressable' in found)) return found.recipients;
  const gone = new Set(found.addresses);
  const rest = ids.filter((id) => !gone.has(id));
  if (rest.length === 0) return [];
  const again = yield* messaging.recipients(rest);
  return 'addressable' in again ? [] : again.recipients;
});

export const SUBSCRIPTION_PAIRS = {
  subscribe_threads: pair(
    OPS.subscribe_threads,
    body(OPS.subscribe_threads, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const subscriptions = yield* ThreadSubscriptions;
        const subscriber = yield* callingThread(caller);
        const targets = yield* collaborating(OPS.subscribe_threads, caller, (verbs) => addressed(verbs.messaging, input.threads));
        if (targets.some((target) => target.id === subscriber)) {
          return yield* new GateRefusal('subscribe-self', 'a thread cannot subscribe to itself.', SELF);
        }
        const held = new Map(
          (yield* subscriptions.subscribe(
            subscriber,
            targets.map((target) => target.id),
            input.wakes,
          )).map((row) => [row.targetId, row.wakes]),
        );
        const now = yield* standing(targets.map((target) => target.id));
        return {
          status: 'subscribed' as const,
          threads: targets.flatMap((target) => {
            const wakes = held.get(target.id);
            return wakes === undefined ? [] : [{ ...followed(target), wakes, now: now(target.id) }];
          }),
        };
      }),
    }),
  ),

  unsubscribe_threads: pair(
    OPS.unsubscribe_threads,
    body(OPS.unsubscribe_threads, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const subscriptions = yield* ThreadSubscriptions;
        const subscriber = yield* callingThread(caller);
        const targets = yield* collaborating(OPS.unsubscribe_threads, caller, (verbs) => addressed(verbs.messaging, input.threads));
        const ended = new Set(
          yield* subscriptions.unsubscribe(
            subscriber,
            targets.map((target) => target.id),
          ),
        );
        return {
          status: 'unsubscribed' as const,
          unsubscribed: targets.filter((target) => ended.has(target.id)).map(followed),
          unheld: targets.filter((target) => !ended.has(target.id)).map(followed),
        };
      }),
    }),
  ),

  read_subscriptions: pair(
    OPS.read_subscriptions,
    body(OPS.read_subscriptions, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const at = input.cursor === undefined ? null : readCursor(input.cursor, QUESTION);
        if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
        const subscriptions = yield* ThreadSubscriptions;
        const rows = yield* subscriptions.of(yield* callingThread(caller));
        const rest = at === null ? rows : pastKey(rows, keyOf, ORDER, at.at);
        const size = pageRows(input.limit, SUBSCRIPTIONS, ceilingOf(SUBSCRIPTIONS));
        const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf, question: QUESTION, total: rows.length });
        const targets =
          cut.rows.length === 0
            ? []
            : yield* collaborating(OPS.read_subscriptions, caller, (verbs) =>
                named(
                  verbs.messaging,
                  cut.rows.map((row) => row.targetId),
                ),
              );
        const byId = new Map(targets.map((target) => [target.id, followed(target)]));
        const now = yield* standing(targets.map((target) => target.id));
        return {
          status: 'read' as const,
          threads: cut.rows.map((row) => ({
            ...(byId.get(row.targetId) ?? { threadId: row.targetId, name: null }),
            wakes: row.wakes,
            now: now(row.targetId),
            since: row.createdAt.toISOString(),
          })),
          total: rows.length,
          cursor: cut.next,
        };
      }),
    }),
  ),
} satisfies Record<string, OperationPair>;
