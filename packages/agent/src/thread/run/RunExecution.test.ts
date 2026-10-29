import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentToolResolution } from '../../agent/door/types';
import { ThreadRunConflictError, type ThreadRunStartFrom, type ThreadRunStorage } from '../storage/runs';
import type { ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { ThreadCallBroke } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { ThreadTailLostError } from '../ThreadFailure';
import { runWorld } from '../conformance/runCycle/runWorld';
import { runRow } from '../conformance/runCycle/runDoubles';
import { runStore } from '../conformance/runCycle/store';
import { inboxFixture } from '../conformance/runCycle/inbox';
import { ThreadRunStopped } from './RunExecution';
import { RunBoundaries } from './RunBoundaries';
const runRef = { id: 'run-1', threadId: 'thread-1' };
const startFrom: ThreadRunStartFrom = {
  id: runRef.threadId,
  ownerId: 'owner-1',
  account: null,
  provider: 'subscription',
  model: null,
  reasoning: null,
  switches: {},
};
const approval = { mode: 'trust' as const, interactive: false };
const resolution: AgentToolResolution = {
  toolCallId: 'call-1',
  name: 'read_selection',
  input: { of: 'root-1' },
  judged: { of: 'root-1' },
  generation: 0,
  preparation: { subjects: [{ kind: 'read', value: 'thread://owner/thread-a' }], prepared: ['thread-a'] },
};
const stopHook = Effect.gen(function* () {
  const said = yield* Deferred.make<unknown>();
  return { said: Deferred.await(said), stop: (reason: unknown) => Effect.asVoid(Deferred.succeed(said, reason)) };
});
describe('RunExecution', () => {
  it.effect('a stopped preparing run remains driven until its opener finishes releasing', () =>
    Effect.gen(function* () {
      const { runs } = runStore([]);
      const { execution } = yield* runWorld(runs);
      const entered = yield* Deferred.make<void>();
      const releasing = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      yield* Effect.addFinalizer(() => Effect.asVoid(Deferred.succeed(released, undefined)));
      yield* execution.create(startFrom, approval);
      yield* execution.launch(
        runRef,
        Effect.andThen(Deferred.succeed(entered, undefined), Effect.never).pipe(
          Effect.ensuring(Effect.andThen(Deferred.succeed(releasing, undefined), Deferred.await(released))),
        ),
      );
      yield* Deferred.await(entered);
      expect(yield* execution.stop(runRef)).toBe('stopped');
      yield* Deferred.await(releasing);
      expect(execution.driven([runRef.threadId])).toEqual([runRef]);
      const drained = yield* Effect.forkScoped(execution.drained(runRef.id), { startImmediately: true });
      expect(drained.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(released, undefined);
      yield* Fiber.join(drained);
      expect(execution.driven([runRef.threadId])).toEqual([]);
    }),
  );
  it.effect(
    'an owned run outside the native tracker waits for its step boundary and settlement',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const stopping = yield* Effect.forkScoped(execution.stop(runRef, { at: 'step', by: 'model', within: Duration.seconds(1) }), {
        startImmediately: true,
      });
      expect(rows.get(runRef.id)?.status).toBe('running');
      const boundary = yield* Effect.exit(execution.checkpoint(runRef));
      expect(Exit.isFailure(boundary) && Cause.hasInterruptsOnly(boundary.cause)).toBe(true);
      expect(yield* Fiber.join(stopping)).toBe('stopped');
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'model' });
    }),
  );
  it.effect(
    'an adapter-held run stops at the step boundary its adapter reports, under the stop`s own by and without a marker',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution, adapter, context, lifecycle } = yield* runWorld(runs);
      adapter.held.add(runRef.id);
      const stopping = yield* Effect.forkScoped(execution.stop(runRef, { at: 'step', by: 'model', within: Duration.seconds(1) }), {
        startImmediately: true,
      });
      yield* Context.get(context, RunBoundaries).reached(runRef);
      while (!adapter.interrupted.includes(runRef.id)) yield* Effect.yieldNow;
      expect(rows.get(runRef.id)).toMatchObject({ status: 'running', stopRequest: { by: 'model', marker: false } });
      yield* lifecycle.stop(runRef, { by: 'model', marker: false, withdraw: false }, false);
      expect(yield* Fiber.join(stopping)).toBe('stopped');
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'model' });
    }),
  );
  it.effect(
    'a step-boundary request expires without cutting a later step',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const stopping = yield* Effect.forkScoped(execution.stop(runRef, { at: 'step', by: 'model', within: Duration.millis(5) }), {
        startImmediately: true,
      });
      yield* TestClock.adjust(5);
      expect(yield* Fiber.join(stopping)).toBe('still-settling');
      expect(Exit.isSuccess(yield* Effect.exit(execution.checkpoint(runRef)))).toBe(true);
      expect(rows.get(runRef.id)).toMatchObject({ status: 'running', stopRequest: null });
    }),
  );
  it.effect(
    'a stop interrupts an untracked opener and an answer resuming a parked run',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([]);
      const { execution } = yield* runWorld(runs);
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      let opened = false;
      yield* execution.create(startFrom, approval);
      yield* execution.launch(
        runRef,
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(gate);
          opened = true;
        }).pipe(Effect.ensuring(Deferred.succeed(closed, undefined))),
      );
      yield* Deferred.await(entered);
      expect(yield* execution.stop(runRef)).toBe('stopped');
      yield* Deferred.await(closed);
      yield* Deferred.succeed(gate, undefined);
      expect(opened).toBe(false);
      const parked = { id: 'run-2', threadId: 'thread-2' };
      rows.set(parked.id, runRow(parked.id, { threadId: parked.threadId, progress: { stage: 'awaiting-question', message: null } }));
      const answering = yield* Deferred.make<void>();
      const resumed = yield* Effect.forkScoped(
        execution.resume(
          parked,
          Effect.fnUntraced(function* (resumption) {
            yield* Deferred.succeed(answering, undefined);
            yield* resumption.interruptible(Effect.never);
          }),
        ),
      );
      yield* Deferred.await(answering);
      expect(yield* execution.stop(parked)).toBe('stopped');
      const answered = yield* Fiber.await(resumed);
      expect(Exit.isFailure(answered) && Cause.hasInterruptsOnly(answered.cause)).toBe(true);
      expect(rows.get(parked.id)?.status).toBe('aborted');
    }),
  );
  it.effect(
    'an awaited stop before resumption work starts completes both waiters',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const resuming = yield* Effect.forkScoped(
        execution.resume(runRef, ({ interruptible }) => interruptible(Effect.never)),
        { startImmediately: true },
      );
      expect(yield* execution.stop(runRef, { by: 'reader', awaitSettled: true })).toBe('stopped');
      const answered = yield* Fiber.await(resuming);
      expect(Exit.isFailure(answered) && Cause.hasInterruptsOnly(answered.cause)).toBe(true);
      expect(execution.holds(runRef.id)).toBe(false);
      expect(rows.get(runRef.id)?.status).toBe('aborted');
    }),
  );
  it.effect(
    'a stop between confirmation and tracking still prevents the tracked work and publishes one ending',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([]);
      const { execution, journal } = yield* runWorld(runs);
      let worked = false;
      let closed = false;
      yield* execution.create(startFrom, approval);
      expect(yield* execution.stop(runRef, { marker: true, by: 'reader' })).toBe('stopped');
      expect(execution.holds(runRef.id)).toBe(false);
      expect(execution.halted(runRef.id)).toBe(true);
      const tracked = yield* execution.track(runRef, {
        work: Effect.sync(() => {
          worked = true;
        }),
        unworked: Effect.sync(() => {
          closed = true;
        }),
      });
      yield* tracked.done;
      expect(worked).toBe(false);
      expect(closed).toBe(true);
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
      expect((yield* journal.eventsAfter(runRef.threadId, 0, 10)).filter((row) => row.kind === 'run-end')).toHaveLength(1);
    }),
  );
  it.effect(
    'an answer waits until the tracker that parked its run has closed',
    Effect.fnUntraced(function* () {
      const { runs } = runStore();
      const { execution } = yield* runWorld(runs);
      const closing = yield* Deferred.make<void>();
      const entered = yield* Deferred.make<void>();
      const tracked = yield* execution.track(runRef, {
        work: Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(closing)),
      });
      tracked.startTracking();
      yield* Deferred.await(entered);
      const answered = yield* Deferred.make<void>();
      const resumed = yield* Effect.forkScoped(
        execution.resume(runRef, () => Deferred.succeed(answered, undefined)),
        { startImmediately: true },
      );
      expect(yield* Deferred.isDone(answered)).toBe(false);
      yield* Deferred.succeed(closing, undefined);
      yield* tracked.done;
      yield* Fiber.join(resumed);
      expect(yield* Deferred.isDone(answered)).toBe(true);
    }),
  );
  it.effect(
    'a stopped adopted start records a typed tail loss before any work can run',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution, lifecycle } = yield* runWorld(runs);
      yield* execution.adopted(runRef);
      yield* lifecycle.stop(runRef, { by: 'reader', marker: true, withdraw: false }, true);
      yield* execution.abort(runRef.id, new ThreadRunStopped('reader'));
      const tracked = yield* execution.track(runRef, {
        work: Effect.void,
        drain: Effect.fail(new ThreadCallBroke({ cause: new ThreadTailLostError(new Error('event page write lost')) })),
      });
      yield* tracked.done;
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader', failure: { type: 'ThreadTailLostError' } });
    }),
  );
  it.effect(
    'aborting an adopted start releases it and drains before settlement and unworked cleanup',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      yield* execution.adopted(runRef);
      yield* execution.abort(runRef.id, new Error('adoption failed'));
      expect(execution.holds(runRef.id)).toBe(false);
      let worked = false;
      let drained = false;
      const tracked = yield* execution.track(runRef, {
        work: Effect.sync(() => {
          worked = true;
        }),
        drain: Effect.sync(() => {
          expect(rows.get(runRef.id)?.status).toBe('running');
          drained = true;
        }),
        unworked: Effect.sync(() => {
          expect(drained).toBe(true);
          expect(rows.get(runRef.id)?.status).toBe('failed');
        }),
      });
      yield* tracked.done;
      expect(worked).toBe(false);
    }),
  );
  it.effect(
    'refuses to open a run whose row stopped between creation and confirmation',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([]);
      const storage: ThreadRunStorage<ThreadTx, ThreadWriteTx> = {
        ...runs,
        createRun: (input, tx) =>
          Effect.map(runs.createRun(input, tx), (started) => {
            rows.set(started.run.id, { ...started.run, status: 'aborted' });
            return started;
          }),
      };
      const { execution } = yield* runWorld(storage);
      expect(Exit.isFailure(yield* Effect.exit(execution.create(startFrom, approval)))).toBe(true);
      expect(execution.holds(runRef.id)).toBe(false);
      expect(rows.get(runRef.id)?.status).toBe('aborted');
    }),
  );
  it.effect(
    'a going run uses its created law and a re-entry reads the thread again',
    Effect.fnUntraced(function* () {
      const { runs } = runStore([]);
      const { execution, laws } = yield* runWorld(runs);
      yield* execution.create(startFrom, approval);
      const opened = laws.of(runRef.threadId, 'review');
      expect(opened().id).toBe('trust');
      laws.move(runRef.threadId, 'bypass');
      expect(opened().id).toBe('bypass');
      const tracked = yield* execution.track(runRef, { work: execution.complete(runRef).pipe(Effect.asVoid) });
      tracked.startTracking();
      yield* tracked.done;
      expect(laws.of(runRef.threadId, 'review')().id).toBe('review');
      expect(laws.of('thread-2', 'bypass')().id).toBe('bypass');
    }),
  );
  it.effect(
    'landing holds prevent both parked resumption and adoption until released',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow(runRef.id, { progress: { stage: 'awaiting-question', message: null } })]);
      const { execution, admission } = yield* runWorld(runs);
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => admission.hold([runRef.threadId])),
            (release) => Effect.sync(release),
          );
          expect(yield* Effect.flip(execution.resumeParked(runRef.threadId, runRef.id))).toMatchObject({
            _tag: 'ThreadRunHeld',
            threadId: runRef.threadId,
          });
          expect(yield* Effect.flip(execution.adopted(runRef))).toMatchObject({ _tag: 'ThreadRunHeld', threadId: runRef.threadId });
          expect(rows.get(runRef.id)?.progress.stage).toBe('awaiting-question');
        }),
      );
      yield* execution.resumeParked(runRef.threadId, runRef.id);
      expect(rows.get(runRef.id)?.progress.stage).toBe('resuming');
    }),
  );
  it.effect(
    'a stop interrupts the run, records its intent beside it, and answers before the finalizer finishes',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const hook = yield* stopHook;
      const entered = yield* Deferred.make<void>();
      const finalizer = yield* Deferred.make<void>();
      const tracked = yield* execution.track(runRef, {
        stop: hook.stop,
        work: Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* hook.said;
          yield* Deferred.await(finalizer);
          yield* execution.settle(runRef, Cause.interrupt());
        }),
      });
      tracked.startTracking();
      yield* Deferred.await(entered);
      expect(yield* execution.stop(runRef, { marker: true, by: 'reader', withdraw: true })).toBe('stopped');
      expect(yield* hook.said).toMatchObject({ by: 'reader', name: 'ThreadRunStopped' });
      expect(rows.get(runRef.id)).toMatchObject({ status: 'running', stopRequest: { by: 'reader', marker: true, withdraw: true } });
      yield* Deferred.succeed(finalizer, undefined);
      yield* tracked.done;
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
    }),
  );
  it.effect(
    'a stop whose intent cannot be written still interrupts, returns the typed failure, and the run still ends aborted',
    Effect.fnUntraced(function* () {
      const { runs, rows, faults } = runStore();
      const { execution } = yield* runWorld(runs);
      const failure = new ThreadStorageFailed({ call: 'requestStop', cause: new Error('The disk is full.') });
      faults.requestStop = failure;
      const hook = yield* stopHook;
      const entered = yield* Deferred.make<void>();
      const tracked = yield* execution.track(runRef, {
        stop: hook.stop,
        work: Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* hook.said;
          yield* execution.settle(runRef, Cause.interrupt());
        }),
      });
      tracked.startTracking();
      yield* Deferred.await(entered);
      expect(yield* Effect.flip(execution.stop(runRef, { marker: true, by: 'reader' }))).toBe(failure);
      expect(yield* hook.said).toBeInstanceOf(ThreadRunStopped);
      yield* tracked.done;
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
    }),
  );
  it.effect(
    'a stop answers before the sweep of its run ends, and sweeps tracked and untracked runs, including a failed intent write',
    Effect.fnUntraced(function* () {
      const other = { id: 'run-2', threadId: 'thread-2' };
      const { runs, faults } = runStore([runRow(runRef.id), runRow(other.id, { threadId: other.threadId })]);
      const { inbox } = inboxFixture();
      for (const run of [runRef, other]) {
        yield* inbox.put({
          id: `item:${run.id}`,
          threadId: run.threadId,
          kind: 'turn',
          sender: { kind: 'reader' },
          body: { text: 'Next turn' },
          occurredAt: new Date(0).toISOString(),
        });
        yield* inbox.deliver([`item:${run.id}`], run.id);
      }
      const slow = yield* Deferred.make<void>();
      const swept = yield* Queue.unbounded<string>();
      const sweep = (_threadId: string, id: string) =>
        Effect.andThen(Deferred.await(slow), inbox.returnTo(id)).pipe(Effect.asVoid, Effect.ensuring(Queue.offer(swept, id)));
      const { execution } = yield* runWorld(runs, { inbox, sweep: { sweep } });
      expect(yield* execution.stop(other, { marker: true, by: 'reader' })).toBe('stopped');
      expect(yield* inbox.receipt(`item:${other.id}`)).toMatchObject({ state: 'acknowledged', deliveredToRunId: other.id });
      yield* Deferred.succeed(slow, undefined);
      expect(yield* Queue.take(swept)).toBe(other.id);
      expect(yield* inbox.receipt(`item:${other.id}`)).toMatchObject({ state: 'acknowledged', deliveredToRunId: other.id });
      const hook = yield* stopHook;
      const entered = yield* Deferred.make<void>();
      const tracked = yield* execution.track(runRef, {
        stop: hook.stop,
        work: Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* hook.said;
        }),
      });
      tracked.startTracking();
      yield* Deferred.await(entered);
      const failure = new ThreadStorageFailed({ call: 'requestStop', cause: new Error('The disk is full.') });
      faults.requestStop = failure;
      expect(yield* Effect.flip(execution.stop(runRef, { marker: true, by: 'reader' }))).toBe(failure);
      expect(yield* Queue.take(swept)).toBe(runRef.id);
      expect(yield* inbox.receipt(`item:${runRef.id}`)).toMatchObject({ state: 'queued', deliveredToRunId: null });
      yield* tracked.done;
    }),
  );
  it.effect(
    'awaitSettled waits for the ending and reports a finalizer beyond its deadline',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const hook = yield* stopHook;
      const entered = yield* Deferred.make<void>();
      const finalizer = yield* Deferred.make<void>();
      const answered = yield* Deferred.make<void>();
      const tracked = yield* execution.track(runRef, {
        stop: hook.stop,
        work: Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* hook.said;
          yield* Deferred.await(finalizer);
          yield* execution.settle(runRef, Cause.interrupt());
        }),
      });
      tracked.startTracking();
      yield* Deferred.await(entered);
      const stopping = yield* Effect.forkScoped(
        execution
          .stop(runRef, { awaitSettled: true, within: Duration.millis(1) })
          .pipe(Effect.tap(() => Deferred.succeed(answered, undefined))),
        { startImmediately: true },
      );
      expect(yield* Deferred.isDone(answered)).toBe(false);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(stopping)).toBe('still-settling');
      expect(rows.get(runRef.id)?.status).toBe('running');
      yield* Deferred.succeed(finalizer, undefined);
      yield* tracked.done;
      expect(rows.get(runRef.id)?.status).toBe('aborted');
    }),
  );
  it.effect(
    'a tracked run stopped before streaming never starts its work',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      let worked = false;
      const tracked = yield* execution.track(runRef, {
        work: Effect.sync(() => {
          worked = true;
        }),
      });
      expect(yield* execution.stop(runRef, { marker: true, by: 'reader' })).toBe('stopped');
      yield* tracked.done;
      expect(worked).toBe(false);
      expect(rows.get(runRef.id)).toMatchObject({
        status: 'aborted',
        settledBy: 'reader',
        stopRequest: { marker: true, by: 'reader', withdraw: false },
      });
    }),
  );
  it.effect(
    'the core ends a run nobody holds and a run whose holder has no turn, whatever the transports answer',
    Effect.fnUntraced(function* () {
      const other = { id: 'run-2', threadId: 'thread-2' };
      const { runs, rows } = runStore([runRow(runRef.id), runRow(other.id, { threadId: other.threadId })]);
      const { execution, adapter } = yield* runWorld(runs);
      adapter.transport.runs.interrupt = (runId) =>
        runId === other.id
          ? Effect.succeed('no-turn')
          : Effect.fail(new ThreadStorageFailed({ call: 'interrupt', cause: new Error('The transport is gone.') }));
      expect(yield* execution.stop(runRef, { marker: true, by: 'reader' })).toBe('stopped');
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader', stopRequest: { marker: true, by: 'reader' } });
      adapter.held.add(other.id);
      expect(yield* execution.stop(other, { marker: true, by: 'reader' })).toBe('stopped');
      expect(rows.get(other.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
    }),
  );
  it.effect(
    'a departing process leaves its run running and hands it over at the owner clock',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const hook = yield* stopHook;
      const entered = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { execution } = yield* runWorld(runs);
          const tracked = yield* execution.track(runRef, {
            stop: hook.stop,
            work: Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* hook.said;
              yield* execution.settle(runRef, Cause.interrupt());
            }),
          });
          tracked.startTracking();
          yield* Deferred.await(entered);
          yield* TestClock.adjust(1_000);
        }),
      );
      expect(yield* hook.said).toBeInstanceOf(Error);
      expect(yield* hook.said).not.toBeInstanceOf(ThreadRunStopped);
      expect(rows.get(runRef.id)).toMatchObject({ status: 'running', stopRequest: null });
      expect(rows.get(runRef.id)?.handedOverAt?.getTime()).toBe(1_000);
    }),
  );
  it.effect(
    'settling re-raises the cause after persisting the failed run',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { execution } = yield* runWorld(runs);
      const failure = new Error('the turn blew up');
      expect(yield* Effect.flip(execution.settling(runRef, Effect.fail(failure)))).toBe(failure);
      expect(rows.get(runRef.id)).toMatchObject({ status: 'failed', failure: { type: 'Error' } });
    }),
  );
  it.effect(
    'a declared create refusal reaches the caller unchanged on its tagged channel',
    Effect.fnUntraced(function* () {
      const { runs, faults } = runStore([]);
      const refusal = new ThreadRunConflictError({ threadId: runRef.threadId, runId: 'run-0' });
      faults.create = refusal;
      const { execution } = yield* runWorld(runs);
      const matched = yield* execution
        .create(startFrom, approval)
        .pipe(Effect.catchTag('ThreadRunConflict', (failure) => Effect.succeed(failure)));
      expect(matched).toBe(refusal);
    }),
  );
  it.effect(
    'ending releases only the resolutions owned by each parked run',
    Effect.fnUntraced(function* () {
      const other = { id: 'run-2', threadId: 'thread-2' };
      const { runs } = runStore([runRow(runRef.id), runRow(other.id, { threadId: other.threadId })]);
      const { execution, parking } = yield* runWorld(runs);
      parking.hold(runRef, 'question-1', [resolution]);
      parking.hold(other, 'question-2', [resolution]);
      expect([...parking.parked()].sort()).toEqual([runRef.id, other.id]);
      yield* execution.complete(runRef);
      expect(parking.parked()).toEqual([other.id]);
      yield* execution.stop(other);
      expect(parking.parked()).toEqual([]);
      expect(parking.take(runRef.id, 'question-1')).toEqual([]);
    }),
  );
});
