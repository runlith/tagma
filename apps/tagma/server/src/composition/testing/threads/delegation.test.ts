import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Layer } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { liveOf } from '../../../settings/live.js';
import { delegation } from '../../../threads/contract/wire/settings.js';
import { republishOnMachineFlip } from '../../../threads/testing/doubles.js';

it.effect('an observed machine flip republishes resting threads, deduplicates unchanged values and isolates a broken publisher', () =>
  Effect.gen(function* () {
    const live = liveOf(() => Effect.succeed([]));
    const settings = Context.get(yield* Layer.build(Layer.mock(Settings, { changes: live.changes })), Settings);
    const machine = (value: boolean) => Effect.sync(() => live.publish(delegation.id, 'user', null, JSON.stringify(value), false));
    const published: string[] = [];
    const first = yield* Deferred.make<void>();
    const three = yield* Deferred.make<void>();
    let broken = true;
    yield* republishOnMachineFlip(
      settings,
      () => ['open-a', 'open-b'],
      (threadId) =>
        Effect.sync(() => {
          if (threadId === 'open-a' && broken) {
            broken = false;
            throw new Error('Projection died');
          }
          published.push(threadId);
          if (published.length === 1) Deferred.doneUnsafe(first, Exit.void);
          if (published.length === 3) Deferred.doneUnsafe(three, Exit.void);
        }),
    );
    yield* machine(true);
    yield* machine(false);
    yield* Deferred.await(first);
    yield* machine(true);
    yield* Deferred.await(three);
    expect(published).toEqual(['open-b', 'open-a', 'open-b']);
  }),
);
