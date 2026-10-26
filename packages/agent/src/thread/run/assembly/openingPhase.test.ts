import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentPhase, AgentWaiting } from '../../../agent/AgentPhase';
import { unreadRuns } from '../../conformance/runCycle/runDoubles';
import type { ThreadState } from '../../state';
import { ThreadOwner, ThreadRunStoreFactory, ThreadStreamRhythm } from '../../ThreadPorts';
import { RunProgress, runProgressLayer } from '../RunProgress';
import { makeThreadLiveFeed, threadFeedLayer } from '../ThreadLiveFeed';
import { openingPhase } from './openingPhase';
const SETUP: AgentWaiting = { reason: 'setup', place: 'tagma-exp-classes-d74152' };
const RUN = { id: 'run-1', threadId: 'thread-1' };
const opened = Effect.gen(function* () {
  const live = yield* makeThreadLiveFeed<ThreadState>();
  const published: (AgentPhase | null)[] = [];
  live.subscribe('thread-1', (event) => {
    if (event.type === 'open' && event.change.op === 'progress') published.push(event.change.progress?.phase ?? null);
  });
  const context = yield* Layer.build(
    runProgressLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threadFeedLayer(live, (state) => Effect.succeed(state)),
          Layer.succeed(ThreadStreamRhythm, { flushIntervalMs: 60_000 }),
          Layer.succeed(ThreadOwner, ThreadOwner.of({ id: 'owner' })),
          Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => unreadRuns })),
        ),
      ),
    ),
  );
  const progress = Context.get(context, RunProgress);
  yield* TestClock.adjust('10 seconds');
  const { waitingOn } = yield* openingPhase(progress, RUN);
  return { progress, waitingOn, published, shown: () => live.view('thread-1').progress?.phase ?? null };
});
it.effect(
  'a wait that outlasts the grace names what the opening waits on from its own start, then gives the opening back',
  Effect.fnUntraced(function* () {
    const { waitingOn, shown } = yield* opened;
    expect(shown()).toEqual({ phase: 'opening', since: 10_000 });
    yield* TestClock.adjust('2 seconds');
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('1500 millis');
    expect(shown()).toEqual({ phase: 'opening', since: 12_000, waiting: SETUP });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    expect(shown()).toEqual({ phase: 'opening', since: 13_500 });
  }),
);
it.effect(
  'a wait shorter than the grace publishes nothing of itself',
  Effect.fnUntraced(function* () {
    const { waitingOn, published } = yield* opened;
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('900 millis');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    expect(published).toEqual([{ phase: 'opening', since: 10_000 }]);
  }),
);
it.effect(
  'the first step phase takes the place of the opening, and a wait that ended never takes it back',
  Effect.fnUntraced(function* () {
    const { progress, waitingOn, shown } = yield* opened;
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('3 seconds');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    yield* progress.enter(RUN, 'preparing');
    expect(shown()).toEqual({ phase: 'preparing', since: 13_000 });
  }),
);
