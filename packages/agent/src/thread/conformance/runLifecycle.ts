import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Fiber, type Scope } from 'effect';
import { readThreadEvents, threadUserMessageEvent, type ThreadEventPayload } from '../events';
import { mintThreadRunId } from '../identity';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, type ThreadRunStopIntent } from '../storage/runs';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { ThreadStateChange } from '../state';
import type { ThreadRunRef } from '../run/ThreadRunLedger';
import { userMessageEntryId } from '../../transcript/entryNames';
import { KEEP_WARM_SIGNAL_TYPE } from '../../transcript/keepWarm';
import { inboxSignalValues, inboxTurnValues } from '../inboxItems';
import { APPROVAL, INSTANCE, OWNER, SCOPE, lifecycleWorld, type LifecycleWorld, started } from './lifecycleWorld';
import { LATE_STOP } from '../run/lifecycle/RunLifecycle';
import type { ThreadStorageFactory } from './storagePort';
const BY_READER: ThreadRunStopIntent = { by: 'reader', marker: false, withdraw: false };
export function describeRunLifecycleActs<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: run lifecycle acts over the storage`, () => {
    test(
      'a beat writes the going run and hands its thread one heartbeat change over the revision the beat advanced',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const handed: ThreadStateChange[] = [];
        world.changes.project((change) => Effect.sync(() => void handed.push(change)));
        const at = new Date((yield* Clock.currentTimeMillis) + 60_000);
        yield* world.lifecycle.beat([{ id: run.id, threadId: run.threadId }], at);
        const ours = handed.filter(
          (change) => change.kind === 'ran' && change.runs.some((beat) => beat.heartbeatAt?.getTime() === at.getTime()),
        );
        expect(ours).toEqual([
          {
            kind: 'ran',
            threadId: run.threadId,
            revision: { from: expect.any(Number), to: expect.any(Number) },
            runs: [{ id: run.id, heartbeatAt: at, updatedAt: at }],
          },
        ]);
        const { revision } = ours[0] as Extract<ThreadStateChange, { kind: 'ran' }>;
        expect(revision.to).toBeGreaterThan(revision.from);
        expect(yield* world.storage.transitions.revision(run.threadId)).toBeGreaterThanOrEqual(revision.to);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ heartbeatAt: at, updatedAt: at });
      }),
    );
    test(
      'a stale beat hands no unwritten heartbeat after an end or ownership loss, including a mixed batch',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const ended = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        yield* world.lifecycle.finish(ended, { kind: 'completed' });
        const lost = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        yield* world.lifecycle.handover([lost.id], new Date(yield* Clock.currentTimeMillis));
        const other = world.storage.runs({ ownerId: 'other-instance', scope: SCOPE });
        const adopted = yield* other.adoptRun(lost.id, {
          selector: { kind: 'handed-over' },
          maxResumes: 1,
          progress: { stage: 'running', message: null },
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
        });
        expect(adopted?.ownerId).toBe('other-instance');
        const thread = yield* world.storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const going = started(yield* world.lifecycle.create({ ...world.startFrom, id: thread.id }, APPROVAL, { kind: 'turn' })).run;
        const before = yield* Effect.all([world.runs.runById(ended.id), world.runs.runById(lost.id)]);
        const at = new Date((yield* Clock.currentTimeMillis) + 60_000);
        yield* world.runs.requestStop(going.id, BY_READER, at);
        const handed: ThreadStateChange[] = [];
        world.changes.project((change) => Effect.sync(() => void handed.push(change)));
        expect(yield* world.lifecycle.beat([ended, lost], at)).toEqual([]);
        expect(handed.flatMap((change) => (change.kind === 'ran' ? change.runs : []))).toEqual([]);
        handed.length = 0;
        expect(yield* world.lifecycle.beat([ended, lost, going], at)).toEqual([{ runId: going.id, by: 'reader' }]);
        expect(handed.flatMap((change) => (change.kind === 'ran' ? change.runs : []))).toEqual([
          { id: going.id, heartbeatAt: at, updatedAt: at },
        ]);
        expect(yield* Effect.all([world.runs.runById(ended.id), world.runs.runById(lost.id)])).toEqual(before);
        expect(yield* world.runs.runById(going.id)).toMatchObject({ ownerId: INSTANCE, heartbeatAt: at, updatedAt: at });
      }),
    );
    test(
      'a refused keep-warm launch closes its refresh signal while returning unread reader work',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'keep-warm' }));
        const refresh = inboxSignalValues(run.threadId, {
          id: 'refresh',
          type: KEEP_WARM_SIGNAL_TYPE,
          addressee: 'transport',
          text: 'refresh',
          occurredAt: run.startedAt.toISOString(),
        });
        const reader = inboxTurnValues(run.threadId, { id: 'reader', text: 'Do the next work.' });
        yield* world.storage.inbox.put(refresh);
        yield* world.storage.inbox.put(reader);
        yield* world.storage.inbox.deliver([refresh.id, reader.id], run.id);
        yield* world.lifecycle.finish(run, {
          kind: 'broke',
          cause: Cause.fail(new Error('The agent could not launch.')),
          departing: false,
          returnsWords: true,
        });
        expect((yield* world.storage.inbox.receipt(refresh.id))?.state).toBe('acknowledged');
        expect((yield* world.storage.inbox.pending(run.threadId)).map((item) => ({ id: item.id, state: item.state }))).toEqual([
          { id: reader.id, state: 'queued' },
        ]);
      }),
    );
    test(
      'a stop and a completion racing over one run: exactly one ends it, writes one run end and publishes once',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const ref = { id: run.id, threadId: run.threadId };
        const [stopped, finished] = yield* Effect.all(
          [world.lifecycle.stop(ref, BY_READER, false), world.lifecycle.finish(ref, { kind: 'completed' })],
          { concurrency: 2 },
        );
        expect([stopped === 'stopped', finished === 'committed'].filter(Boolean)).toHaveLength(1);
        expect([stopped, finished]).toContain('not-running');
        const row = yield* world.runs.runById(run.id);
        expect(row?.status).toBe(stopped === 'stopped' ? 'aborted' : 'completed');
        const events = yield* readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 1_000);
        expect(events.filter((event) => event.kind === 'run-end')).toHaveLength(1);
        expect(world.published).toEqual([run.id]);
      }),
    );
    test.each(['opening failure', 'reap'] as const)(
      'a stop requested before %s enters its write unit gives both acts one aborted ending',
      Effect.fnUntraced(function* (act) {
        const storage = yield* open();
        const waiting = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        const writeAt = storage.transitions.writeAt.bind(storage.transitions);
        let held = true;
        storage.transitions.writeAt = (threadId, work) =>
          Effect.suspend(() => {
            const write = writeAt(threadId, work);
            if (!held) return write;
            held = false;
            return Effect.andThen(Deferred.succeed(waiting, undefined), Effect.andThen(Deferred.await(resume), write));
          });
        const world = yield* lifecycleWorld(() => Effect.succeed(storage));
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const finishing = yield* Effect.forkScoped(
          act === 'opening failure'
            ? world.lifecycle.finish(run, { kind: 'broke', cause: Cause.fail(new Error('opening failed')), departing: false })
            : world.lifecycle.reap(
                {
                  ...run,
                  gapMs: 1,
                  resumeLimit: 1,
                  selector: { kind: 'stale-heartbeat', heartbeatBefore: new Date(run.heartbeatAt.getTime() + 1) },
                },
                'the opener is gone',
                false,
              ),
        );
        yield* Deferred.await(waiting);
        yield* Effect.ensuring(
          Effect.gen(function* () {
            expect(yield* world.lifecycle.stop(run, BY_READER, true)).toBe('requested');
          }),
          Deferred.succeed(resume, undefined),
        );
        expect(yield* Fiber.join(finishing)).toBe('committed');
        expect(yield* world.lifecycle.stop(run, BY_READER, false)).toBe('not-running');
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'aborted', settledBy: 'reader', failure: null });
        expect((yield* world.endings.read(run.id))?.ended).toMatchObject({ status: 'aborted', stoppedBy: 'reader' });
        const events = yield* readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 100);
        expect(events.map((event) => event.kind)).toEqual(['run-end']);
        expect(world.published).toEqual([run.id]);
      }),
    );
    test(
      'finish refuses a parked run naming its state, and the run stays parked',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const ref = { id: run.id, threadId: run.threadId };
        expect(yield* world.lifecycle.park(ref)).toBe('parked');
        expect(yield* Effect.flip(world.lifecycle.finish(ref, { kind: 'completed' }))).toMatchObject({
          _tag: 'RunActRefused',
          act: 'finish',
          state: 'parked',
        });
        expect(yield* world.runs.runById(run.id)).toMatchObject({
          status: 'running',
          progress: { stage: THREAD_RUN_AWAITING_QUESTION_STAGE },
        });
      }),
    );
    test(
      'a stop requested while the run goes is honoured by its park, ending it aborted by the stopper',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const ref = { id: run.id, threadId: run.threadId };
        expect(yield* world.lifecycle.stop(ref, BY_READER, true)).toBe('requested');
        expect(yield* world.lifecycle.park(ref)).toBe('stopped');
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
        expect(yield* world.lifecycle.stop(ref, BY_READER, false)).toBe('not-running');
        expect(world.published).toEqual([run.id]);
      }),
    );
    test(
      'a run the agent finished while a stop stood ends aborted by the stopper, marked late, with its words handled once',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const words = inboxTurnValues(run.threadId, { id: 'words', text: 'Do the next work.' });
        yield* world.storage.inbox.put(words);
        yield* world.storage.inbox.deliver([words.id], run.id);
        expect(yield* world.lifecycle.stop(run, BY_READER, true)).toBe('requested');
        expect(yield* world.lifecycle.finish(run, { kind: 'completed' })).toBe('committed');
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'aborted', settledBy: 'reader', progress: LATE_STOP });
        expect((yield* world.endings.read(run.id))?.ended).toMatchObject({ status: 'aborted', stoppedBy: 'reader', handled: [words.id] });
        expect(yield* world.storage.inbox.pending(run.threadId)).toEqual([]);
      }),
    );
    test(
      'a resume over a standing stop refuses and ends the parked run aborted by the stopper',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
        const ref = { id: run.id, threadId: run.threadId };
        yield* world.lifecycle.park(ref);
        expect(yield* world.runs.requestStop(ref.id, BY_READER, new Date(yield* Clock.currentTimeMillis))).not.toBeNull();
        expect(yield* Effect.flip(world.lifecycle.resume(run.threadId, run.id))).toMatchObject({
          _tag: 'RunActRefused',
          act: 'resume',
          state: 'stopped',
        });
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
      }),
    );
    test(
      'a keyed start answers its run as a value even while admission is held, and the key with other content refuses',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const key = { key: 'turn-1', digest: 'digest-a' };
        const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn', startKey: key }));
        world.admission.hold([run.threadId]);
        expect(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn', startKey: key })).toMatchObject({
          _tag: 'Replayed',
          run: { id: run.id },
        });
        expect(
          yield* Effect.flip(world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn', startKey: { ...key, digest: 'digest-b' } })),
        ).toMatchObject({ _tag: 'ThreadRunKeyReused', runId: run.id });
      }),
    );
    test(
      "finish and stop in the caller's unit end the run with it, after the caller's own thread write, and only wake settlement after its commit",
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const threadId = world.startFrom.id;
        const first = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        const inside: {
          woken: readonly string[] | null;
        } = { woken: null };
        const release = world.holdSettlement();
        const finished = yield* world.storage.aggregate.transaction(
          Effect.fnUntraced(function* (unit) {
            const ended = yield* endedIn(world, 'finish', first, unit);
            inside.woken = [...world.published];
            return ended;
          }),
        );
        expect(finished).toBe('committed');
        expect(inside.woken).toEqual([]);
        expect(world.published).toEqual([]);
        release();
        yield* world.settled(1);
        expect(yield* world.runs.runById(first.id)).toMatchObject({ status: 'completed' });
        expect((yield* world.endings.read(first.id))?.ended.runId).toBe(first.id);
        const second = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        const stopped = yield* world.storage.aggregate.transaction((unit) =>
          Effect.andThen(
            world.storage.eventLog.append({ threadId, id: 'caller-write', kind: 'probe', payload: {} }, unit),
            endedIn(world, 'stop', second, unit),
          ),
        );
        expect(stopped).toBe('stopped');
        yield* world.settled(2);
        expect(yield* world.runs.runById(second.id)).toMatchObject({ status: 'aborted' });
        expect((yield* world.storage.eventLog.eventsAfter(threadId, 0, 100)).map((event) => event.kind)).toEqual([
          'run-end',
          'probe',
          'run-end',
        ]);
        expect(world.published).toEqual([first.id, second.id]);
      }),
    );
    test(
      'finish and stop in a unit that turns back leave no end, no ending row and no wake, and the run still ends later',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        for (const act of ['finish', 'stop', 'broke'] as const) {
          const failed = yield* Effect.flip(
            world.storage.aggregate.transaction((unit) =>
              Effect.andThen(endedIn(world, act, run, unit), Effect.fail('turned back' as const)),
            ),
          );
          expect(failed).toBe('turned back');
        }
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running' });
        expect(yield* world.storage.eventLog.eventsAfter(run.threadId, 0, 100)).toEqual([]);
        expect(yield* world.endings.read(run.id)).toBeNull();
        const now = yield* Clock.currentTimeMillis;
        const claim = { heartbeatBefore: new Date(now + 60_000), now: new Date(now), limit: 1, maxAttempts: 3 };
        expect(yield* world.runs.claimSettledForNotification(claim)).toEqual({ claims: [], exhausted: [] });
        expect(world.published).toEqual([]);
        expect(yield* world.lifecycle.finish(run, { kind: 'completed' })).toBe('committed');
        expect(world.published).toEqual([run.id]);
      }),
    );
    test(
      'observing in one unit withdraws the unread run and opens the observed turn, whose words stand after the cut',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const threadId = world.startFrom.id;
        const first = yield* world.storage.aggregate.transaction((unit) => observing(world, null, 'first words', unit));
        expect(first).toMatchObject({ displaced: null, opened: { status: 'running' } });
        const attempt: {
          opened: string | null;
        } = { opened: null };
        const failed = yield* Effect.flip(
          world.storage.aggregate.transaction((unit) =>
            Effect.flatMap(observing(world, first.opened.id, 'second words', unit), (seen) => {
              attempt.opened = seen.opened.id;
              return Effect.fail('turned back' as const);
            }),
          ),
        );
        expect(failed).toBe('turned back');
        expect(yield* world.runs.runById(first.opened.id)).toMatchObject({ status: 'running' });
        expect(yield* world.runs.runById(attempt.opened!)).toBeNull();
        expect(world.published).toEqual([]);
        const second = yield* world.storage.aggregate.transaction((unit) => observing(world, first.opened.id, 'second words', unit));
        expect(second.displaced).toMatchObject({ id: first.opened.id, status: 'withdrawn' });
        expect(second.opened).toMatchObject({ status: 'running' });
        expect((yield* world.runs.runningOf([threadId])).map((row) => row.id)).toEqual([second.opened.id]);
        const events = yield* readThreadEvents(world.storage.eventLog, world.storage.kinds, threadId, 0, 1_000);
        expect(events.map((event) => [event.kind, runOf(event.payload)])).toEqual([
          ['message', first.opened.id],
          ['withdrawal', first.opened.id],
          ['message', second.opened.id],
        ]);
        const thread = yield* world.storage.aggregate.find(threadId);
        expect(thread?.status).toBe('running');
        expect(thread?.history).toHaveLength(1);
        expect((yield* world.storage.aggregate.transcriptOf(threadId))?.map((entry) => entry.id)).toEqual([
          userMessageEntryId(second.opened.id),
        ]);
        yield* world.settled(1);
        expect(world.published).toEqual([first.opened.id]);
      }),
    );
    test(
      'observing over a run that holds nothing withdraws it and leaves no run end in the feed',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const threadId = world.startFrom.id;
        const empty = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' })).run;
        const seen = yield* world.storage.aggregate.transaction((unit) => observing(world, empty.id, 'operator words', unit));
        expect(seen.displaced).toMatchObject({ id: empty.id, status: 'withdrawn' });
        const events = yield* readThreadEvents(world.storage.eventLog, world.storage.kinds, threadId, 0, 1_000);
        expect(events.map((event) => [event.kind, runOf(event.payload)])).toEqual([
          ['withdrawal', empty.id],
          ['message', seen.opened.id],
        ]);
        expect((yield* world.storage.aggregate.transcriptOf(threadId))?.map((entry) => entry.id)).toEqual([
          userMessageEntryId(seen.opened.id),
        ]);
        yield* world.settled(1);
      }),
    );
  });
}
function within(unit: unknown): ThreadWriteTx {
  return unit as ThreadWriteTx;
}
function endedIn<TTx, TWrite extends TTx>(
  world: LifecycleWorld<TTx, TWrite>,
  act: 'finish' | 'stop' | 'broke',
  run: ThreadRunRef,
  unit: unknown,
) {
  return act === 'stop'
    ? world.lifecycle.stop(run, BY_READER, false, within(unit))
    : world.lifecycle.finish(
        run,
        act === 'finish' ? { kind: 'completed' } : { kind: 'broke', cause: Cause.fail(new Error('opening failed')), departing: false },
        within(unit),
      );
}
function observing<TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>, displaces: string | null, words: string, unit: unknown) {
  const runId = mintThreadRunId();
  return world.lifecycle.observe({
    startFrom: world.startFrom,
    approval: APPROVAL,
    runId,
    displaces,
    startKey: { key: runId, digest: runId },
    entries: [threadUserMessageEvent({ id: runId }, { text: words, reader: false })],
    tx: within(unit),
  });
}
function runOf(payload: ThreadEventPayload): string | undefined {
  const entry = payload.entry;
  if (entry !== undefined && 'runId' in entry && typeof entry.runId === 'string') return entry.runId;
  return payload.withdrawn?.runId;
}
