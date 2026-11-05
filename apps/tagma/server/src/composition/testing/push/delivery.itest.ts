import { join } from 'node:path';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Data, Effect, FileSystem, Layer, PubSub, Queue, Schedule, Stream } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { Notifications, type NotificationChange } from '../../../notify/contract/service/notifications.js';
import type { Notification } from '../../../notify/contract/wire/notification.js';
import { Sender, type Sent } from '../../../push/contract/service/sender.js';
import { Subscriptions } from '../../../push/contract/service/subscriptions.js';
import { push } from '../../../push/push.js';
import { Devices, type DeviceRevoked } from '../../../remote/contract/service/devices.js';
import { Attention, type AttentionChange } from '../../../threads/contract/service/attention.js';
import type { AttentionRow } from '../../../threads/contract/wire/attention.js';
import { fixtureMigrations } from '../migrations.js';

type Call = { readonly endpoint: string; readonly tag: string; readonly body: string; readonly url: string; readonly badge: number };

class Machine extends Context.Service<Machine, Context.Context<MachineStore | MachineUnits>>()('testing/PushMachine') {}

class NotYet extends Data.TaggedError('NotYet')<{}> {}

const unused = () => Effect.die('outside push');

const subscription = (device: string) => ({
  endpoint: `https://push.example/${device}`,
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
  auth: Buffer.alloc(16, 3).toString('base64url'),
});

const failed = Effect.fnUntraced(function* (threadId: string, runId: string): Effect.fn.Return<AttentionRow> {
  return {
    project: { id: 1, name: 'demo' },
    threadId,
    title: threadId,
    name: null,
    parentId: null,
    kind: 'failed',
    eventId: `${runId}:failed`,
    at: new Date(yield* Clock.currentTimeMillis).toISOString(),
    runId,
    ask: null,
    said: null,
    failure: { ending: 'failed', reason: 'exited with code 129', type: null, detail: null, httpStatus: null },
  };
});

const asked = Effect.fnUntraced(function* (id: string, title = id): Effect.fn.Return<Notification> {
  return {
    id,
    sender: 'plugin:poker',
    title,
    body: '',
    at: new Date(yield* Clock.currentTimeMillis).toISOString(),
    question: { text: 'Raise to 40?', options: ['Yes', 'No'] },
    link: null,
  };
});

const server = Effect.fnUntraced(function* () {
  const machine = yield* Machine;
  const answers = new Map<string, Sent>();
  const gone = new Set<string>();
  const calls = yield* Queue.unbounded<Call>();
  const revoked = yield* PubSub.unbounded<DeviceRevoked>();
  const changes = yield* Queue.unbounded<AttentionChange>();
  const notices = yield* Queue.unbounded<NotificationChange>();
  const doubles = Layer.succeedContext(
    Context.make(Sender, {
      send: (target, message) =>
        Effect.as(
          Queue.offer(calls, { endpoint: target.endpoint, ...(JSON.parse(message.payload) as Omit<Call, 'endpoint'>) }),
          answers.get(target.endpoint) ?? { _tag: 'accepted' },
        ),
    }).pipe(
      Context.add(Attention, { changes: Stream.fromQueue(changes) }),
      Context.add(Notifications, {
        send: unused,
        answer: unused,
        dismiss: unused,
        withdraw: unused,
        keys: unused,
        changes: Stream.fromQueue(notices),
      }),
      Context.add(Devices, {
        admit: unused,
        pair: unused,
        code: unused(),
        standing: unused(),
        list: unused,
        revoke: unused,
        paired: (id) => Effect.sync(() => !gone.has(id)),
        revoked: Stream.fromPubSub(revoked),
      }),
    ),
  );
  const context = yield* Layer.build(push.lifetimes.serving.pipe(Layer.provide(doubles), Layer.provide(Layer.succeedContext(machine))));
  const subscriptions = Context.get(context, Subscriptions);
  const next = Queue.take(calls);
  const until = <E>(holds: Effect.Effect<boolean, E>) =>
    Effect.retry(
      Effect.flatMap(holds, (standing) => (standing ? Effect.void : Effect.fail(new NotYet()))),
      { schedule: Schedule.spaced('20 millis') },
    );
  return {
    subscriptions,
    answers,
    gone,
    calls,
    revoked,
    next,
    until,
    push: (change: AttentionChange) => Queue.offer(changes, change),
    notify: (change: NotificationChange) => Queue.offer(notices, change),
    devices: Effect.map(subscriptions.status(null), (status) => [...status.devices].sort().join()),
  };
});

const store = Layer.effect(
  Machine,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-push-' });
    return yield* Layer.build(
      unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, {}, sharedPool))),
      ),
    );
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(store, { excludeTestServices: true })('push delivery', (it) => {
  it.effect('an event sent once is never sent again: not on a rename, not after an archive and a restore, not after a restart', () =>
    Effect.gen(function* () {
      const row = yield* Effect.gen(function* () {
        const first = yield* server();
        yield* first.subscriptions.subscribe('phone', subscription('phone'));
        const row = yield* failed('t1', 'r1');
        yield* first.push({ _tag: 'all', rows: [] });
        yield* first.push({ _tag: 'put', row });
        expect(yield* first.next).toMatchObject({
          endpoint: subscription('phone').endpoint,
          tag: 't1',
          body: 'Failed: exited with code 129',
        });

        yield* first.push({ _tag: 'put', row: { ...row, title: 'renamed' } });
        yield* first.push({ _tag: 'gone', threadId: 't1' });
        yield* first.push({ _tag: 'put', row });
        yield* first.push({ _tag: 'put', row: yield* failed('t2', 'r2') });
        expect(yield* first.next).toMatchObject({ tag: 't2' });
        return row;
      }).pipe(Effect.scoped);

      yield* Effect.gen(function* () {
        const second = yield* server();
        yield* second.push({ _tag: 'all', rows: [row, yield* failed('t3', 'r3')] });
        expect(yield* second.next).toMatchObject({ tag: 't3' });
        yield* second.subscriptions.unsubscribe('phone');
      }).pipe(Effect.scoped);
    }),
  );

  it.effect(
    'a subscription its push service calls gone is dropped, and a revoked device is sent nothing more, even when its revocation was not heard',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* server();
          yield* running.subscriptions.subscribe('kept', subscription('kept'));
          yield* running.subscriptions.subscribe('revoked', subscription('revoked'));
          yield* running.subscriptions.subscribe('gone', subscription('gone'));
          running.answers.set(subscription('gone').endpoint, { _tag: 'gone' });
          yield* running.push({ _tag: 'all', rows: [] });
          yield* running.push({ _tag: 'put', row: yield* failed('t4', 'r4') });
          const reached = new Set([(yield* running.next).endpoint, (yield* running.next).endpoint, (yield* running.next).endpoint]);
          expect(reached.size).toBe(3);
          yield* running.until(Effect.map(running.devices, (devices) => devices === 'kept,revoked'));

          running.gone.add('revoked');
          yield* running.push({ _tag: 'put', row: yield* failed('t5', 'r5') });
          expect(yield* running.next).toMatchObject({ endpoint: subscription('kept').endpoint, tag: 't5' });
          yield* running.until(Effect.map(running.devices, (devices) => devices === 'kept'));
          expect(yield* Queue.size(running.calls)).toBe(0);

          yield* running.subscriptions.subscribe('later', subscription('later'));
          yield* PubSub.publish(running.revoked, { deviceId: 'later' });
          yield* running.until(Effect.map(running.devices, (devices) => devices === 'kept'));
          yield* running.subscriptions.unsubscribe('kept');
        }),
      ),
  );

  it.effect('a notification reaches the phone as a link to its durable question, once, and a plain one does not raise the badge', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* server();
        yield* running.subscriptions.subscribe('phone', subscription('phone'));
        yield* running.notify({ _tag: 'all', rows: [] });
        yield* running.notify({ _tag: 'put', row: yield* asked('n1') });
        expect(yield* running.next).toMatchObject({ tag: 'notification:n1', url: '/?notification=n1', body: 'Raise to 40?', badge: 1 });

        yield* running.notify({ _tag: 'put', row: yield* asked('n1', 'renamed') });
        yield* running.notify({ _tag: 'put', row: { ...(yield* asked('n2', 'fyi')), body: 'Table closed', question: null } });
        expect(yield* running.next).toMatchObject({ tag: 'notification:n2', body: 'Table closed', badge: 1 });
        expect(yield* Queue.size(running.calls)).toBe(0);
        yield* running.subscriptions.unsubscribe('phone');
      }),
    ),
  );
});
