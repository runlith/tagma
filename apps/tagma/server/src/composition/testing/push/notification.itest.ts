import { join } from 'node:path';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import { Notifications } from '../../../notify/contract/service/notifications.js';
import { Outcomes, type Settled } from '../../../notify/contract/service/outcomes.js';
import { notify } from '../../../notify/notify.js';
import { NotificationContributions } from '../../../notify/contract/service/contributions.js';
import { sendersLayer } from '../../../notify/receiving.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { Sender } from '../../../push/contract/service/sender.js';
import { Subscriptions } from '../../../push/contract/service/subscriptions.js';
import { push } from '../../../push/push.js';
import { Devices } from '../../../remote/contract/service/devices.js';
import { Attention } from '../../../threads/contract/service/attention.js';
import { fixtureMigrations } from '../migrations.js';

const unused = () => Effect.die('outside this test');

it.live('an app asks, the question reaches the phone as a link and the stored outcome reaches the app once, whoever answers again', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-notification-' });
    const pushes = yield* Queue.unbounded<{ readonly tag: string; readonly url: string; readonly body: string }>();
    const handed = yield* Queue.unbounded<Settled>();
    const doubles = Layer.succeedContext(
      Context.make(Sender, {
        send: (_target, message) => Effect.as(Queue.offer(pushes, JSON.parse(message.payload)), { _tag: 'accepted' as const }),
      }).pipe(
        Context.add(Outcomes, { deliver: (outcome) => Effect.asVoid(Queue.offer(handed, outcome)) }),
        Context.add(Attention, { changes: Stream.empty }),
        Context.add(Devices, {
          admit: unused,
          pair: unused,
          code: unused(),
          standing: unused(),
          list: unused,
          revoke: unused,
          paired: () => Effect.succeed(true),
          revoked: Stream.empty,
        }),
      ),
    );
    const store = unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations))),
    );
    const notified = notify.lifetimes.serving.pipe(
      Layer.provide(
        Layer.mergeAll(doubles, sendersLayer, Layer.succeed(NotificationContributions, { declare: () => Effect.succeed(() => undefined) })),
      ),
    );
    const context = yield* Layer.build(
      push.lifetimes.serving.pipe(Layer.provide(doubles), Layer.provideMerge(notified), Layer.provide(store)),
    );
    const subscriptions = Context.get(context, Subscriptions);
    const notifications = Context.get(context, Notifications);

    yield* subscriptions.subscribe('phone', {
      endpoint: 'https://push.example/phone',
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
      auth: Buffer.alloc(16, 3).toString('base64url'),
    });
    const sent = yield* notifications.send('app:poker', {
      title: 'Table 3',
      body: '',
      question: { text: 'Raise to 40?', options: ['Yes', 'No'] },
    });
    const reached = yield* Queue.take(pushes);
    expect(reached).toMatchObject({ tag: `notification:${sent.id}`, url: `/?notification=${sent.id}`, body: 'Raise to 40?' });

    const answered = yield* notifications.answer(sent.id, 'Yes');
    const again = yield* notifications.answer(sent.id, 'No');
    expect(answered).toMatchObject({ repeated: false, outcome: { kind: 'answered', answer: 'Yes' } });
    expect(again).toMatchObject({ repeated: true, outcome: answered.outcome });
    expect(yield* Queue.take(handed)).toMatchObject({
      id: sent.id,
      sender: 'app:poker',
      kind: 'answered',
      answer: 'Yes',
    });
    expect(yield* Queue.size(handed)).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)),
);
