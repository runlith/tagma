import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Brand, Deferred, Duration, Effect, Fiber, Layer } from 'effect';
import { type AgentCalls, makeAgentCalls } from '@runlith/agent/AgentCalls';
import { TestClock } from 'effect/testing';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadDeleteStillSettlingError } from '@runlith/agent/thread/storage/aggregate';
import type { EngineHandles } from '@runlith/agent/thread/AgentHarness';
import type { ThreadStop } from '@runlith/agent/thread/ending';
import { RunAdmission, makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ThreadLookup, ThreadRunning } from './contract/service/reads.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadList } from './contract/service/list.js';
import { HarnessCalls, McpForgetting, ThreadTeardown } from './contract/service/engine.js';
import { HarnessAsides } from './contract/service/asides.js';
import { ThreadReleasing } from './contract/service/releasing.js';
import { HeldTasks } from './contract/service/heldTasks.js';
import { ThreadRollouts } from './contract/service/rollouts.js';
import type { ThreadRelation } from '../thread-record/contract/wire/record.js';
import { makeRunSweep, makeThreadEnding } from './ending.js';
import type { HarnessId } from '../platform/contract/wire/session.js';
import { writes } from '../platform/contract/service/writes.js';

const unexpected = (): never => {
  throw new Error('the ending called an unrelated synchronous service member');
};

const stand = Effect.fnUntraced(function* (
  over: {
    readonly calls?: AgentCalls;
    readonly subtree?: readonly string[];
    readonly kernel?: Effect.Effect<boolean, ThreadCallBroke>;
    readonly release?: Effect.Effect<'stopped' | 'not-running', GateRefusal>;
    readonly commands?: Effect.Effect<void, GateRefusal>;
    readonly running?: string | null;
    readonly stopping?: Effect.Effect<ThreadStop>;
    readonly relation?: ThreadRelation;
    readonly patience?: Duration.Duration;
  } = {},
) {
  const events: string[] = [];
  const forgotten: string[] = [];
  const calls = over.calls ?? (yield* makeAgentCalls({ history: 200 }));
  const threadIds = over.subtree ?? ['root'];
  const owners = Layer.mergeAll(
    Layer.mock(ThreadLookup, {
      subtree: () => Effect.succeed(threadIds.map((id) => ({ id, projectId: 3, harness: null, host: null }))),
    }),
    Layer.mock(ThreadRunning, {
      runningRunOf: () => Effect.succeed(over.running === undefined ? 'run-going' : over.running),
      heldSessionsInSubtree: () =>
        Effect.succeed(
          over.running === null
            ? []
            : [{ runId: over.running ?? 'run-going', threadId: 'root', kind: 'run', harness: Brand.nominal<HarnessId>()('tagma') }],
        ),
    }),
    Layer.mock(ThreadRecords, {
      projectOf: () => Effect.succeed(3),
      relation: () => Effect.succeed(over.relation ?? 'subtree'),
      writes: writes('ending-test', []),
      birthRecorded: unexpected,
      removalRecorded: unexpected,
      titleRecorded: unexpected,
      statusPublished: unexpected,
      shelfRecorded: unexpected,
      readDegraded: unexpected,
    }),
    Layer.mock(ThreadList, {
      subscribeAttention: unexpected,
      observe: unexpected,
      subscribe: unexpected,
      announce: unexpected,
      announceFolders: unexpected,
      resync: unexpected,
      serveArchiving: unexpected,
      serveCuts: unexpected,
    }),
    Layer.succeed(McpForgetting, {
      forget: (id) => {
        forgotten.push(id);
      },
    }),
    Layer.mock(HarnessAsides, { forget: () => Effect.void, of: unexpected, watch: unexpected }),
    Layer.mock(ThreadRollouts, {
      freeing: () => Effect.succeed(Effect.void),
      pathOf: unexpected,
      appendRecord: unexpected,
      queueMeta: unexpected,
      formRested: unexpected,
      shelve: unexpected,
      rewritten: unexpected,
    }),
    Layer.succeed(ThreadReleasing, {
      release: (id) =>
        Effect.andThen(
          Effect.sync(() => events.push(`release:${id}`)),
          over.release ?? Effect.succeed('not-running' as const),
        ),
      serve: () => () => {},
    }),
    Layer.succeed(ThreadTeardown, {
      endCommands: (input) =>
        Effect.andThen(
          Effect.sync(() => events.push(`commands:${input.threadIds.join(',')}:${input.cause}`)),
          over.commands ?? Effect.void,
        ),
      endHeld: () =>
        Effect.sync(() => {
          events.push('held');
        }),
      afterDeleted: () =>
        Effect.sync(() => {
          events.push('after-deleted');
        }),
    }),
    Layer.succeed(HarnessCalls, calls),
    Layer.succeed(RunAdmission, makeLandingHolds()),
    Layer.succeed(HeldTasks, { left: () => Effect.void }),
  );
  const sweep = yield* makeRunSweep().pipe(Effect.provide(owners));
  const harness: EngineHandles = {
    handle: (threadId: string) => ({
      stop: Effect.fnUntraced(function* (run?: string) {
        const stopped: ThreadStop = yield* over.stopping ?? Effect.succeed({ status: 'stopped' as const, runId: run ?? 'run-going' });
        events.push(`stop:${threadId}`);
        if (stopped.status === 'stopped') yield* sweep.sweep(threadId, stopped.runId);
        return stopped;
      }),
      delete: () =>
        Effect.andThen(
          Effect.sync(() => events.push('deleted')),
          over.kernel ?? Effect.succeed(true),
        ),
    }),
  };
  const ending = yield* makeThreadEnding({
    harness,
    patience: over.patience === undefined ? undefined : { settle: over.patience },
  }).pipe(Effect.provide(owners));
  return { ending, events, forgotten };
});

const runningCall = Effect.fnUntraced(function* (calls: AgentCalls, runId: string, toolCallId: string, background: boolean) {
  const call = calls.open({ threadId: 'root', runId, toolCallId, name: 'bash', input: {} });
  const entered = yield* Deferred.make<void>();
  const waiter = yield* Effect.forkChild(
    call.run({
      work: Effect.andThen(Deferred.succeed(entered, undefined), Effect.never),
      background: () => 'receipt',
      stopped: () => Effect.succeed('stopped'),
      completed: () => Effect.void,
      release: Effect.void,
    }),
  );
  yield* Deferred.await(entered);
  if (background) {
    yield* call.handOff();
    expect(yield* Fiber.join(waiter)).toBe('receipt');
  }
  return call;
});

describe('thread ending', () => {
  it.effect('deletion stops the subtree and its work before deleting rows and forgetting its owners', () =>
    Effect.gen(function* () {
      const world = yield* stand({ subtree: ['root', 'child'] });
      expect(yield* world.ending.delete('root', 3)).toBe(true);
      expect(world.events).toEqual([
        'stop:root',
        'commands:root:run-abort',
        'commands:root,child:scope-closed',
        'release:root',
        'release:child',
        'held',
        'deleted',
        'after-deleted',
      ]);
      expect(world.forgotten).toEqual(['root', 'child']);
    }),
  );

  it.effect('a refused release leaves the thread and its owners standing', () =>
    Effect.gen(function* () {
      const refusal = new GateRefusal('session-uncertain', 'the agent process ending is unknown', ['read the thread']);
      const world = yield* stand({ release: Effect.fail(refusal) });
      expect(yield* Effect.flip(world.ending.delete('root', 3))).toBe(refusal);
      expect(world.events).toEqual(['stop:root', 'commands:root:run-abort', 'commands:root:scope-closed', 'release:root']);
      expect(world.forgotten).toEqual([]);
    }),
  );

  it.effect('deleting a lineage or a thread in another project refuses before work is stopped', () =>
    Effect.gen(function* () {
      const world = yield* stand({ relation: 'lineage' });
      expect(yield* Effect.flip(world.ending.delete('root', 9))).toMatchObject({ reason: 'other-project' });
      expect(
        yield* Effect.flip(
          world.ending.delete('root', 3, {
            kind: 'thread',
            threadId: 'child',
            projectId: 3,
            principalId: 'owner',
            session: { harness: 'tagma', key: 'child' },
          }),
        ),
      ).toMatchObject({ code: 'own-lineage' });
      expect(world.events).toEqual([]);
    }),
  );

  it.effect('deletion reports a kernel that is still settling without forgetting its owners', () =>
    Effect.gen(function* () {
      const world = yield* stand({
        kernel: Effect.fail(new ThreadCallBroke({ cause: new ThreadDeleteStillSettlingError('child', 'run-child') })),
      });
      expect(yield* Effect.flip(world.ending.delete('root', 3))).toMatchObject({ code: 'still-settling' });
      expect(world.forgotten).toEqual([]);
    }),
  );

  it.effect('stop ends only foreground invocations of the run it stopped; idle stop leaves background work going', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const earlier = yield* runningCall(calls, 'run-earlier', 'call-earlier', true);
      const detached = yield* runningCall(calls, 'run-going', 'call-detached', true);
      const waited = yield* runningCall(calls, 'run-going', 'call-waited', false);
      const world = yield* stand({ calls });
      expect(yield* world.ending.stop('root', 3, undefined, { door: 'stop_run' })).toEqual({ status: 'stopped', runId: 'run-going' });
      expect(waited.record.phase).toBe('stopped');
      expect(detached.record.phase).toBe('running');
      expect(earlier.record.phase).toBe('running');
      const idle = yield* stand({ calls, running: null, stopping: Effect.succeed({ status: 'nothing-running' as const }) });
      expect(yield* idle.ending.stop('root', 3, undefined, { door: 'stop_run' })).toEqual({ status: 'nothing-running' });
      expect(detached.record.phase).toBe('running');
    }),
  );

  it.effect('deletion waits for a detached invocation before deleting its owner', () =>
    Effect.gen(function* () {
      const calls = yield* makeAgentCalls({ history: 200 });
      const call = yield* runningCall(calls, 'run-going', 'detached', true);
      const world = yield* stand({
        calls,
        kernel: Effect.sync(() => {
          expect(call.record.phase).toBe('stopped');
          return true;
        }),
      });
      expect(yield* world.ending.delete('root', 3)).toBe(true);
    }),
  );

  it.effect('deletion lets confirmed cleanup finish beyond the settle patience before forgetting its owners', () =>
    Effect.gen(function* () {
      const world = yield* stand({ patience: Duration.millis(1), kernel: Effect.as(Effect.sleep(10), true) });
      const deleting = yield* Effect.forkChild(world.ending.delete('root', 3));
      yield* TestClock.adjust(Duration.millis(1));
      expect(world.forgotten).toEqual([]);
      yield* TestClock.adjust(Duration.millis(9));
      expect(yield* Fiber.join(deleting)).toBe(true);
      expect(world.forgotten).toEqual(['root']);
      expect(world.events.at(-1)).toBe('after-deleted');
    }),
  );
});
