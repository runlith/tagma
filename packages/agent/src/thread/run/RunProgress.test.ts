import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentPhase } from '../../agent/AgentPhase';
import { unreadRuns } from '../conformance/runCycle/runDoubles';
import type { ThreadState } from '../state';
import { ThreadOwner, ThreadRunStoreFactory, ThreadStreamRhythm } from '../ThreadPorts';
import { RunProgress, runProgressLayer } from './RunProgress';
import { makeThreadLiveFeed, threadFeedLayer } from './ThreadLiveFeed';
import { threadChangesLayer } from './ThreadChanges';
const RUN = { id: 'run-1', threadId: 'thread-1' };
const progressed = Effect.gen(function* () {
  const live = yield* makeThreadLiveFeed<ThreadState>();
  const stored: (AgentPhase | null)[] = [];
  const runs = {
    ...unreadRuns,
    writePhase: (_runId: string, phase: AgentPhase | null) => Effect.sync(() => void stored.push(phase)),
  };
  const context = yield* Layer.build(
    runProgressLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threadChangesLayer,
          threadFeedLayer(live, (state) => Effect.succeed(state)),
          Layer.succeed(ThreadStreamRhythm, { flushIntervalMs: 250 }),
          Layer.succeed(ThreadOwner, ThreadOwner.of({ id: 'owner' })),
          Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => runs })),
        ),
      ),
    ),
  );
  return { progress: Context.get(context, RunProgress), stored, shown: () => live.view('thread-1').progress };
});
it.effect(
  'a phase change keeps the context estimate the run published before it',
  Effect.fnUntraced(function* () {
    const { progress, shown } = yield* progressed;
    yield* progress.estimate(RUN, { stepNumber: 0, tokens: 1_200, contextWindow: 200_000 });
    yield* progress.enter(RUN, 'writing');
    expect(shown()).toEqual({ phase: { phase: 'writing', since: 0 }, estimate: { stepNumber: 0, tokens: 1_200, contextWindow: 200_000 } });
  }),
);
it.effect(
  'a phase no run write carries reaches the run row one rhythm later, and one thinking spell keeps its start',
  Effect.fnUntraced(function* () {
    const { progress, stored } = yield* progressed;
    yield* progress.enter(RUN, 'calling');
    yield* TestClock.adjust('100 millis');
    yield* progress.enter(RUN, 'reasoning');
    expect(stored).toEqual([]);
    yield* TestClock.adjust('200 millis');
    expect(stored).toEqual([{ phase: 'reasoning', since: 0 }]);
  }),
);
