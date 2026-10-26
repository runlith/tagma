import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Result } from 'effect';
import { Usage, sumUsage } from '@runlith/llm/schema/events';
import type { AgentRunOutput } from '../../agent/AgentRunner';
import { AgentRunBroke } from '../../agent/AgentFailure';
import type { ThreadRunRow } from '../rows';
import type { ThreadRunStorage } from '../storage/runs';
import { ThreadCallBroke, threadCauseOf } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { ThreadTailLostError } from '../ThreadFailure';
import type { ThreadTx } from '../ThreadPorts';
import { threadRunUsage, driveThreadRun, type ThreadRunProjection } from './ThreadRunCycle';
import { emptyToolOutputs, runRow, unreadRuns } from '../conformance/runCycle/runDoubles';
import { runWorld } from '../conformance/runCycle/runWorld';
it.effect(
  'a parked projection stays running and finalization distinguishes follow-up from completion',
  Effect.fnUntraced(function* () {
    const store = cycleStore();
    const { execution } = yield* runWorld(store.runs);
    const finalized: boolean[] = [];
    const parked = yield* driveThreadRun(execution, {
      ...projection('run-parked'),
      onComplete: () => Effect.succeed({ parked: 'parked', hasVisibleOutput: true, usage: null }),
      onFinally: ({ awaitingFollowup }) =>
        Effect.sync(() => {
          finalized.push(awaitingFollowup);
        }),
    });
    parked.startTracking();
    yield* parked.done;
    expect((yield* store.runs.runById('run-parked'))?.status).toBe('running');
    const completed = yield* driveThreadRun(execution, {
      ...projection('run-finished'),
      onFinally: ({ awaitingFollowup }) =>
        Effect.sync(() => {
          finalized.push(awaitingFollowup);
        }),
    });
    completed.startTracking();
    yield* completed.done;
    expect((yield* store.runs.runById('run-finished'))?.status).toBe('completed');
    expect(finalized).toEqual([true, false]);
  }),
);
for (const lostWrites of [0, 1, 2]) {
  it.effect(
    `a failed run settles only after its final tail writes (${lostWrites} refused writes)`,
    Effect.fnUntraced(function* () {
      const store = cycleStore();
      const { execution, journal } = yield* runWorld(store.runs);
      const providerFailure = new Error('provider died');
      const storageFailure = new Error('event page write lost');
      let attempts = 0;
      let finalized = false;
      const failing: ThreadRunProjection = {
        ...projection('run-failed'),
        output: { ...streamOutput(), steps: Effect.fail(new AgentRunBroke({ cause: providerFailure })) },
        flush: Effect.suspend(() => {
          expect(store.read('run-failed').status).toBe('running');
          attempts += 1;
          return attempts <= lostWrites ? Effect.fail(new ThreadCallBroke({ cause: storageFailure })) : Effect.void;
        }),
        onFinally: () =>
          Effect.sync(() => {
            finalized = true;
          }),
      };
      const tracked = yield* driveThreadRun(execution, failing);
      tracked.startTracking();
      const ended = yield* Effect.result(tracked.done);
      expect(Result.isFailure(ended)).toBe(true);
      if (Result.isFailure(ended)) {
        const cause = threadCauseOf(ended.failure);
        if (lostWrites === 2) {
          expect(cause).toBeInstanceOf(ThreadTailLostError);
          if (cause instanceof ThreadTailLostError) expect(cause.cause).toBe(storageFailure);
        } else expect(cause).toBe(providerFailure);
      }
      expect(attempts).toBe(Math.min(lostWrites + 1, 2));
      expect((yield* store.runs.runById('run-failed'))?.status).toBe('failed');
      expect((yield* journal.eventsAfter('thread-1', 0, 10)).map((entry) => entry.kind)).toEqual(['failure', 'run-end']);
      expect(finalized).toBe(true);
    }),
  );
}
it.effect(
  'interruption preserves the usage already charged by completed steps',
  Effect.fnUntraced(function* () {
    const paid = new Usage({ inputTokens: 1_000, outputTokens: 100, totalTokens: 1_100 });
    const store = cycleStore(paid);
    const { execution } = yield* runWorld(store.runs);
    const entered = yield* Deferred.make<void>();
    const torn = yield* Deferred.make<never, AgentRunBroke>();
    const tracked = yield* driveThreadRun(execution, {
      ...projection('run-aborted'),
      stop: (cause) => Effect.asVoid(Deferred.fail(torn, new AgentRunBroke({ cause }))),
      output: { ...streamOutput(), steps: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(torn))) },
      completedSteps: () => [{ content: [], text: '', reasoningText: undefined, toolCalls: [], toolResults: [], usage: paid }],
    });
    tracked.startTracking();
    yield* Deferred.await(entered);
    yield* execution.abort('run-aborted', new Error('aborted'));
    yield* tracked.done;
    expect((yield* store.runs.runById('run-aborted'))?.usage).toEqual(paid);
  }),
);
test('a provider that reported no tokens has no usage row', () => {
  expect(threadRunUsage(new Usage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }))).toBeNull();
});
for (const providerFailed of [false, true]) {
  it.effect(
    `output disposal cannot change the run outcome (provider failed: ${providerFailed})`,
    Effect.fnUntraced(function* () {
      const store = cycleStore();
      const { execution } = yield* runWorld(store.runs);
      const failure = new Error('provider died');
      let finalized = false;
      const base = projection('run-dispose-fails');
      const tracked = yield* driveThreadRun(execution, {
        ...base,
        output: providerFailed ? { ...base.output, steps: Effect.fail(new AgentRunBroke({ cause: failure })) } : base.output,
        toolOutputs: {
          ...emptyToolOutputs,
          dispose: () => Effect.fail(new ThreadStorageFailed({ call: 'dispose', cause: new Error('scratch I/O lost') })),
        },
        onFinally: () =>
          Effect.sync(() => {
            finalized = true;
          }),
      });
      tracked.startTracking();
      const ended = yield* Effect.result(tracked.done);
      expect(Result.isFailure(ended)).toBe(providerFailed);
      if (Result.isFailure(ended)) expect(threadCauseOf(ended.failure)).toBe(failure);
      expect((yield* store.runs.runById('run-dispose-fails'))?.status).toBe(providerFailed ? 'failed' : 'completed');
      expect(finalized).toBe(true);
    }),
  );
}
function projection(id: string): ThreadRunProjection {
  return {
    run: runRow(id),
    stop: () => Effect.void,
    output: streamOutput(),
    completedSteps: () => [],
    toolOutputs: emptyToolOutputs,
    flush: Effect.void,
    onComplete: () => Effect.succeed({ parked: null, hasVisibleOutput: true, usage: null }),
    onFinally: () => Effect.void,
  };
}
function streamOutput(): AgentRunOutput {
  return {
    finishReason: Effect.succeed('stop'),
    response: Effect.succeed({ messages: [] }),
    steps: Effect.succeed([]),
    text: Effect.succeed(''),
    usage: Effect.succeed(new Usage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })),
  };
}
function cycleStore(usage: Usage | null = null) {
  const rows = new Map<string, ThreadRunRow>();
  const read = (id: string) => rows.get(id) ?? runRow(id, { usage });
  const runs: ThreadRunStorage<ThreadTx> = {
    ...unreadRuns,
    runById: (id) => Effect.sync(() => read(id)),
    latestRun: () => Effect.succeed(null),
    settleRun: (id, patch) =>
      Effect.sync(() => {
        const row = { ...read(id), ...patch };
        rows.set(id, row);
        return row;
      }),
    addUsage: (id, delta) =>
      Effect.sync(() => {
        rows.set(id, { ...read(id), usage: sumUsage(read(id).usage, delta) });
      }),
    markStatus: () => Effect.void,
    writeSettledNotification: () => Effect.succeed(true),
    markSettledNotified: () => Effect.succeed(true),
    heartbeatSettledClaim: () => Effect.void,
    handOverRuns: () => Effect.void,
  };
  return { runs, read };
}
