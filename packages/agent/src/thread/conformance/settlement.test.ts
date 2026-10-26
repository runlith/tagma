import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Layer } from 'effect';
import type { ThreadState } from '../state';
import { ThreadCallBroke } from '../ThreadBorder';
import type { ThreadWriteTx } from '../ThreadPorts';
import { openMemoryStorage } from './memoryStorage';
import { hangingTurn } from './runLog/scripts';
import { gate } from './runLog/support';
import { openedRun, startedTurn } from './runLog/world';

const makeFixture = Effect.gen(function* () {
  const settlement = gate();
  const running = gate();
  const stack = yield* openedRun(openMemoryStorage, {
    onSettled: () => Effect.andThen(Effect.sync(settlement.reach), settlement.released),
  });
  stack.world.plan.push(hangingTurn({ chunks: [], reached: running.reach }));
  const turn = yield* startedTurn(stack.world, stack.thread.id, 'Work on this turn.');
  yield* running.reached;
  return { ...stack, turn, settlement };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('test/settlement/Fixture') {}

layer(Layer.effect(Fixture, makeFixture))('settlement subscriptions', (it) => {
  it.effect(
    'a subscription receives confirmation after settlement finishes in the background',
    Effect.fnUntraced(function* () {
      const { storage, world, thread, turn, settlement } = yield* Fixture;
      const confirmed = yield* Deferred.make<ThreadState>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          world.harness.reads.subscribe(thread.id, (event) => {
            if (event.type !== 'state') return;
            const state = event.frame.state;
            if (state.latestRun?.id === turn.runId && state.latestRun.settledNotifiedAt !== null) {
              Deferred.doneUnsafe(confirmed, Effect.succeed(state));
            }
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      const ended = world.harness.runs.reports().of('native').ended({ id: turn.runId, threadId: thread.id }, { kind: 'completed' });
      expect(
        yield* storage.aggregate.transaction((tx) =>
          ended.run(tx as unknown as ThreadWriteTx).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
        ),
      ).toMatchObject({ status: 'applied', runId: turn.runId });
      yield* settlement.reached;
      yield* Effect.ensuring(
        Effect.gen(function* () {
          expect((yield* world.harness.reads.snapshot(thread.id)).latestRun).toMatchObject({
            id: turn.runId,
            status: 'completed',
            settledNotifiedAt: null,
          });
        }),
        Effect.sync(settlement.release),
      );
      expect((yield* Deferred.await(confirmed)).latestRun).toMatchObject({
        id: turn.runId,
        status: 'completed',
        settledNotifiedAt: expect.any(Date),
      });
    }),
  );
});
