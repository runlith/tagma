import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { fakeAdapter } from '../conformance/fakeTransport';
import { openMemoryStorage } from '../conformance/memoryStorage';
import { openedRun, OWNER, SCOPE } from '../conformance/runLog/world';
import { TRANSITION_PATIENCE_MS } from '../transition/kernel';

it.effect('restart replaces the resource after its stop patience even when transport interruption cannot drain', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const launched = yield* Deferred.make<string>();
    const ended = yield* Deferred.make<void>();
    const adapter = fakeAdapter('waiting-stop');
    const { storage, world, thread } = yield* openedRun(openMemoryStorage, {
      transport: { adapter: adapter.transport.adapter, profile: null, agent: 'hosted' },
      onSettled: () => Effect.asVoid(Deferred.succeed(ended, undefined)),
    });
    yield* world.harness.runs.transports().register({
      ...adapter.transport,
      runs: {
        ...adapter.transport.runs,
        launch: (launch) => Effect.tap(adapter.transport.runs.launch(launch), () => Deferred.succeed(launched, launch.run.id)),
        interrupt: () =>
          Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(released), 'no-turn' as const)).pipe(
            Effect.uninterruptible,
          ),
      },
      resource: {
        release: () => Effect.as(Deferred.succeed(released, undefined), 'stopped' as const),
        seated: () => Effect.void,
        watch: () => Effect.void,
      },
    });
    const handle = world.harness.threads.handle(thread.id, OWNER);
    yield* handle.send('Keep the turn open.');
    const runId = yield* Deferred.await(launched);
    const restarting = yield* Effect.forkScoped(handle.restart());
    yield* Effect.addFinalizer(() => Effect.asVoid(Deferred.succeed(released, undefined)));
    yield* Deferred.await(entered);
    yield* TestClock.adjust(TRANSITION_PATIENCE_MS);
    expect((yield* Fiber.join(restarting)).stoppedRunId).toBe(runId);
    yield* Deferred.await(ended);
    expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runById(runId))?.status).toBe('aborted');
  }),
);
