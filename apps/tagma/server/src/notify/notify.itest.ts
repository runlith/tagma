import { and, count, isNotNull, isNull } from 'drizzle-orm';
import { fixtureMigrations } from '../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, Exit, Layer, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { type NotificationChange, Notifications } from './contract/service/notifications.js';
import { OutcomeRefused, Outcomes, type Settled } from './contract/service/outcomes.js';
import { OPEN_PER_SENDER } from './contract/wire/notification.js';
import { notifyLayer } from './layer.js';
import { NotificationContributions } from './contract/service/contributions.js';
import { Senders } from './contract/service/senders.js';
import { sendersLayer } from './receiving.js';
import { notification } from './store/tables.js';
import { NOTIFY_PAIRS as PAIRS } from './operations.js';

const storage = Layer.unwrap(
  Effect.map(sharedPool, (pool) =>
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool)),
    ),
  ),
);

const poker: Caller = { actor: { kind: 'external', name: 'plugin:poker', plugin: 'poker' }, files: null };
const operator: Caller = { actor: { kind: 'operator' }, files: null };

const question = { text: 'Raise to 40?', options: ['Yes', 'No'] };

type Receive = Outcomes['Service']['deliver'];

const admittedSenders = Layer.effect(
  Senders,
  Effect.gen(function* () {
    const senders = yield* Senders;
    senders.register('plugin:poker', { deliver: () => Effect.void });
    senders.register('plugin:crm', { deliver: () => Effect.void });
    return senders;
  }),
).pipe(Layer.provide(sendersLayer));

const call = <A, E>(work: Effect.Effect<A, E, unknown>, notifications: Notifications['Service']) =>
  work.pipe(Effect.provideService(Notifications, notifications), Effect.provide(admittedSenders)) as Effect.Effect<A, E>;

const send = (
  notifications: Notifications['Service'],
  input: { title: string; body?: string; question?: typeof question; key?: string },
  as = poker,
) => call(PAIRS.send_notification.body.execute(input, undefined, as), notifications);

const answer = (notifications: Notifications['Service'], id: string, value: string) =>
  call(PAIRS.answer_notification.body.execute({ id, value }, undefined, operator), notifications);

const dismiss = (notifications: Notifications['Service'], id: string) =>
  call(PAIRS.dismiss_notification.body.execute({ id }, undefined, operator), notifications);

const boot = Effect.fnUntraced(function* (receive: Receive) {
  const scope = yield* Scope.fork(yield* Scope.Scope);
  const built = yield* Layer.buildWithScope(
    notifyLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Outcomes, { deliver: receive }),
          Layer.succeed(NotificationContributions, { declare: () => Effect.succeed(() => undefined) }),
          sendersLayer,
        ),
      ),
    ),
    scope,
  );
  return { notifications: Context.get(built, Notifications), stop: Scope.close(scope, Exit.void) };
});

const watch = Effect.fnUntraced(function* (notifications: Notifications['Service']) {
  const seen = yield* Queue.unbounded<NotificationChange>();
  yield* Effect.forkScoped(Stream.runForEach(notifications.changes, (change) => Queue.offer(seen, change)));
  return seen;
});

const until = Effect.fnUntraced(function* (holds: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (yield* holds) return;
    yield* Effect.promise(() => Bun.sleep(5));
  }
  return yield* Effect.die('the awaited state never came');
});

const world = <A, E>(work: Effect.Effect<A, E, MachineStore | MachineUnits | Scope.Scope>) => work.pipe(Effect.provide(storage));

it.effect(
  'an external sender asks, the question stands in Attention, the first answer settles the outcome for the sender and a second changes nothing',
  () =>
    world(
      Effect.gen(function* () {
        const handed: Settled[] = [];
        const { notifications } = yield* boot((outcome) => Effect.sync(() => void handed.push(outcome)));
        const seen = yield* watch(notifications);
        expect(yield* Queue.take(seen)).toEqual({ _tag: 'all', rows: [] });

        const sent = yield* send(notifications, { title: 'Table 3', body: 'Dealer is waiting', question });
        expect(yield* Queue.take(seen)).toMatchObject({
          _tag: 'put',
          row: { id: sent.id, sender: 'plugin:poker', title: 'Table 3', question },
        });

        const first = yield* answer(notifications, sent.id, 'Yes');
        expect(first).toMatchObject({ status: 'resolved', id: sent.id, repeated: false, outcome: { kind: 'answered', answer: 'Yes' } });
        expect(yield* Queue.take(seen)).toEqual({ _tag: 'gone', id: sent.id });
        yield* until(Effect.sync(() => handed.length === 1));
        expect(handed[0]).toMatchObject({ id: sent.id, sender: 'plugin:poker', kind: 'answered', answer: 'Yes' });

        const again = yield* answer(notifications, sent.id, 'No');
        expect(again).toMatchObject({ repeated: true, outcome: first.outcome });
        expect(yield* dismiss(notifications, sent.id)).toMatchObject({ repeated: true, outcome: first.outcome });
        expect(handed).toHaveLength(1);
      }),
    ),
);

it.effect(
  'a notification without a question is taken off by the operator, a question accepts only its options, and an operator is no sender',
  () =>
    world(
      Effect.gen(function* () {
        const handed: Settled[] = [];
        const { notifications } = yield* boot((outcome) => Effect.sync(() => void handed.push(outcome)));
        const plain = yield* send(notifications, { title: 'Table closed' });
        const asking = yield* send(notifications, { title: 'Raise?', question });

        expect(yield* Effect.flip(answer(notifications, plain.id, 'Yes'))).toMatchObject({ code: 'no-question' });
        expect(yield* Effect.flip(answer(notifications, asking.id, 'Maybe'))).toMatchObject({ code: 'bad-answer' });
        expect(yield* Effect.flip(send(notifications, { title: 'Hello' }, operator))).toMatchObject({ code: 'sender-required' });
        expect(
          yield* Effect.flip(
            send(
              notifications,
              { title: 'Hello' },
              { actor: { kind: 'external', name: 'plugin:unknown', plugin: 'unknown' }, files: null },
            ),
          ),
        ).toMatchObject({ code: 'sender-required' });
        expect(yield* Effect.flip(dismiss(notifications, 'unknown'))).toMatchObject({ code: 'not-found' });

        expect(yield* dismiss(notifications, plain.id)).toMatchObject({ repeated: false, outcome: { kind: 'dismissed', answer: null } });
        yield* until(Effect.sync(() => handed.length === 1));
        expect(handed[0]).toMatchObject({ id: plain.id, kind: 'dismissed', answer: null });
      }),
    ),
);

it.effect('an outcome the receiver refuses is handed again later and again after a restart, and once taken it is never handed twice', () =>
  world(
    Effect.gen(function* () {
      let ready = false;
      const handed: Settled[] = [];
      const attempts = yield* Queue.unbounded<void>();
      const attempted = () => Queue.offer(attempts, undefined);
      const receive: Receive = (outcome) =>
        ready
          ? Effect.tap(
              Effect.sync(() => void handed.push(outcome)),
              attempted,
            )
          : Effect.tapError(Effect.fail(new OutcomeRefused({ reason: 'the plugin is not running' })), attempted);
      const store = yield* MachineStore;
      const owed = Effect.orDie(
        Effect.map(
          store.db
            .select({ owed: count() })
            .from(notification)
            .where(and(isNotNull(notification.endedAt), isNull(notification.deliveredAt)))
            .get(),
          (row) => row?.owed ?? 0,
        ),
      );

      const first = yield* boot(receive);
      const later = yield* send(first.notifications, { title: 'Raise?', question });
      yield* answer(first.notifications, later.id, 'No');
      yield* Queue.take(attempts);
      expect(handed).toHaveLength(0);
      ready = true;
      yield* TestClock.adjust(5_000);
      yield* Queue.take(attempts);
      yield* until(Effect.map(owed, (left) => left === 0));
      expect(handed[0]).toMatchObject({ id: later.id, kind: 'answered', answer: 'No' });

      ready = false;
      const stopped = yield* send(first.notifications, { title: 'Call?', question });
      yield* answer(first.notifications, stopped.id, 'Yes');
      yield* Queue.take(attempts);
      yield* first.stop;

      ready = true;
      const second = yield* boot(receive);
      yield* Queue.take(attempts);
      yield* until(Effect.map(owed, (left) => left === 0));
      expect(handed).toHaveLength(2);
      expect(handed[1]).toMatchObject({ id: stopped.id, kind: 'answered', answer: 'Yes' });
      yield* second.stop;
    }),
  ),
);

const DAY = 86_400_000;

it.effect('a running server forgets notifications settled over a week ago and keeps the ones settled since', () =>
  world(
    Effect.gen(function* () {
      const { notifications } = yield* boot(() => Effect.void);
      const old = yield* send(notifications, { title: 'old' });
      yield* dismiss(notifications, old.id);

      yield* TestClock.adjust(2 * DAY);
      const recent = yield* send(notifications, { title: 'recent' });
      yield* dismiss(notifications, recent.id);

      yield* TestClock.adjust(6 * DAY);
      const still = yield* send(notifications, { title: 'still running' });
      expect(yield* dismiss(notifications, still.id)).toMatchObject({ repeated: false, outcome: { kind: 'dismissed' } });
      yield* TestClock.adjust('1 hour');
      yield* until(Effect.map(Effect.result(dismiss(notifications, old.id)), (answer) => answer._tag === 'Failure'));
      expect(yield* Effect.flip(dismiss(notifications, old.id))).toMatchObject({ code: 'not-found' });
      expect(yield* dismiss(notifications, recent.id)).toMatchObject({ repeated: true, outcome: { kind: 'dismissed' } });
    }),
  ),
);

it.effect(
  'a send with a key returns the notification it first made, open, settled or after a restart, and another sender or no key makes its own',
  () =>
    world(
      Effect.gen(function* () {
        const crm: Caller = { actor: { kind: 'external', name: 'plugin:crm', plugin: 'crm' }, files: null };
        const first = yield* boot(() => Effect.void);
        const seen = yield* watch(first.notifications);
        expect(yield* Queue.take(seen)).toEqual({ _tag: 'all', rows: [] });

        const made = yield* send(first.notifications, { title: 'Issue 42 changed', key: 'issue-42' });
        expect(made).toMatchObject({ repeated: false });
        const again = yield* send(first.notifications, { title: 'another words', question, key: 'issue-42' });
        expect(again).toEqual({ status: 'sent', id: made.id, repeated: true });
        expect(yield* Queue.take(seen)).toMatchObject({ _tag: 'put', row: { id: made.id, title: 'Issue 42 changed' } });
        expect(yield* Queue.size(seen)).toBe(0);

        const other = yield* send(first.notifications, { title: 'Issue 42 changed', key: 'issue-42' }, crm);
        expect(other).toMatchObject({ repeated: false });
        expect(other.id).not.toBe(made.id);
        const bare = yield* send(first.notifications, { title: 'No key' });
        const bareAgain = yield* send(first.notifications, { title: 'No key' });
        expect(bare.id).not.toBe(bareAgain.id);

        yield* dismiss(first.notifications, made.id);
        expect(yield* send(first.notifications, { title: 'Issue 42 changed', key: 'issue-42' })).toEqual({
          status: 'sent',
          id: made.id,
          repeated: true,
        });

        yield* first.stop;
        const second = yield* boot(() => Effect.void);
        expect(yield* send(second.notifications, { title: 'Issue 42 changed', key: 'issue-42' })).toMatchObject({
          id: made.id,
          repeated: true,
        });
      }),
    ),
);

it.effect(
  'concurrent sends of one key make one notification, and a known key still answers at the open limit while a new one is refused',
  () =>
    world(
      Effect.gen(function* () {
        const { notifications } = yield* boot(() => Effect.void);
        const sends = yield* Effect.all(
          Array.from({ length: 2 }, () => send(notifications, { title: 'Issue 7', key: 'issue-7' })),
          { concurrency: 2 },
        );
        expect(new Set(sends.map((sent) => sent.id)).size).toBe(1);
        expect(sends.filter((sent) => !sent.repeated)).toHaveLength(1);

        for (let held = 1; held < OPEN_PER_SENDER; held++) yield* send(notifications, { title: `n${held}` });
        expect(yield* send(notifications, { title: 'Issue 7', key: 'issue-7' })).toMatchObject({ id: sends[0]!.id, repeated: true });
        expect(yield* Effect.flip(send(notifications, { title: 'Issue 8', key: 'issue-8' }))).toMatchObject({ code: 'too-many-open' });
        expect(
          yield* send(
            notifications,
            { title: 'another sender' },
            { actor: { kind: 'external', name: 'plugin:crm', plugin: 'crm' }, files: null },
          ),
        ).toMatchObject({ repeated: false });
      }),
    ),
);
