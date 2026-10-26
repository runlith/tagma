import type { RunStage } from '../../../transcript/live';
import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Data, Effect, Result, type Scope } from 'effect';
import { ThreadStorageFailed } from '../../persisted';
import { Usage } from '@runlith/llm/schema/events';
import { THREAD_RUN_RESUMING_STAGE, ThreadRunConflictError } from '../../storage/runs';
import type { ThreadStorageFactory } from '../storagePort';
import {
  ABANDONED,
  AWAITING,
  INSTANCE,
  OTHER_INSTANCE,
  OTHER_SCOPE,
  OWNER,
  SCOPE,
  adoptInput,
  entry,
  reapPatch,
  settlePatch,
  started,
  startInput,
  stopPatch,
} from './support';
import { describeRunNotifications } from './notifications';
class SettleRefused extends Data.TaggedError('SettleRefused')<Record<string, never>> {}
export function describeThreadRunPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeRunNotifications(name, open, test);
  describe(`${name}: thread run port`, () => {
    test(
      'a second run is refused while one is running, and the next turn starts after it settles',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const firstInput = startInput(thread);
        const first = yield* started(
          runs.createRun({
            ...firstInput,
            startFrom: { ...firstInput.startFrom, account: 'account-two', switches: { serviceTier: 'priority' } },
          }),
        );
        expect(first.account).toBe('account-two');
        expect(first.switches).toEqual({ serviceTier: 'priority' });
        expect(yield* Effect.flip(started(runs.createRun(startInput(thread))))).toBeInstanceOf(ThreadRunConflictError);
        yield* runs.settleRun(first.id, yield* settlePatch('completed'));
        const second = yield* started(runs.createRun(startInput(thread)));
        expect(second.id).not.toBe(first.id);
      }),
    );
    test(
      'concurrent starts produce exactly one run',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const attempts = yield* Effect.all(
          Array.from({ length: 2 }, () => Effect.result(started(runs.createRun(startInput(thread))))),
          { concurrency: 2 },
        );
        const won = attempts.filter(Result.isSuccess);
        expect(won).toHaveLength(1);
        for (const rejected of attempts.filter(Result.isFailure)) {
          expect(rejected.failure).toBeInstanceOf(ThreadRunConflictError);
        }
      }),
    );
    test(
      'a settled run frees the thread even when the settle raced the next start',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const [settled, next] = yield* Effect.all(
          [
            Effect.result(runs.settleRun(run.id, yield* settlePatch('completed'))),
            Effect.result(started(runs.createRun(startInput(thread)))),
          ],
          { concurrency: 2 },
        );
        expect(Result.isSuccess(settled)).toBe(true);
        for (const failure of [next].filter(Result.isFailure)) expect(failure.failure).toBeInstanceOf(ThreadRunConflictError);
        expect(yield* runs.latestRun(thread.id, ['running'])).toEqual(
          Result.isSuccess(next) ? expect.objectContaining({ status: 'running' }) : null,
        );
      }),
    );
    test(
      'every run of a thread is answered oldest first, and only that thread`s',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* started(runs.createRun(startInput(thread)));
        yield* runs.settleRun(first.id, yield* settlePatch('completed'));
        const second = yield* started(runs.createRun(startInput(thread)));
        yield* started(runs.createRun(startInput(other)));
        expect((yield* runs.runsOf(thread.id)).map((row) => row.id)).toEqual([first.id, second.id]);
        expect(yield* runs.runsOf('no-such-thread')).toEqual([]);
      }),
    );
    test(
      'the newest run of each named thread is answered in one read, and a thread without runs is left out',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const bare = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* started(runs.createRun(startInput(thread)));
        yield* runs.settleRun(first.id, yield* settlePatch('completed'));
        const second = yield* started(runs.createRun(startInput(thread)));
        const alone = yield* started(runs.createRun(startInput(other)));
        const latest = yield* runs.latestRuns([thread.id, other.id, bare.id, 'no-such-thread']);
        expect(latest.map((row) => [row.threadId, row.id]).sort()).toEqual(
          [
            [thread.id, second.id],
            [other.id, alone.id],
          ].sort(),
        );
        expect(yield* runs.latestRuns([])).toEqual([]);
      }),
    );
    test(
      'a run keeps the kind it started with: on its row, among the reap candidates and in its settled claim',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const kinds = ['turn', 'keep-warm', 'compaction'] as const;
        const threads = yield* Effect.forEach(kinds, () => harness.createThread({ ownerId: OWNER, scope: SCOPE }));
        const created = yield* Effect.forEach(kinds, (kind, index) => started(dead.createRun(startInput(threads[index]!, kind))));
        expect(created.map((run) => run.kind)).toEqual([...kinds]);
        expect((yield* dead.runById(created[1]!.id))?.kind).toBe('keep-warm');
        const candidates = yield* alive.reapableRuns(yield* ABANDONED);
        expect(candidates.map((candidate) => [candidate.id, candidate.kind]).sort()).toEqual(
          created.map((run) => [run.id, run.kind]).sort(),
        );
        for (const run of created) yield* dead.settleRun(run.id, yield* settlePatch('failed'));
        const claimed = yield* alive.claimSettledForNotification({
          heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 60_000),
          now: new Date(yield* Clock.currentTimeMillis),
          limit: 10,
          maxAttempts: 10,
        });
        expect(claimed.claims.map((claim) => [claim.id, claim.kind]).sort()).toEqual(created.map((run) => [run.id, run.kind]).sort());
      }),
    );
    test(
      'a run parked on a question survives the boot reap, a running one does not',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const parked = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const streaming = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const parkedRun = yield* started(dead.createRun(startInput(parked)));
        const streamingRun = yield* started(dead.createRun(startInput(streaming)));
        yield* dead.writeProgress(parkedRun.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        yield* dead.writeStreamTail(streamingRun.id, [entry('shown-tail')], new Date(yield* Clock.currentTimeMillis));
        const candidates = yield* alive.reapableRuns(yield* ABANDONED);
        expect(candidates.map((row) => row.id)).toEqual([streamingRun.id]);
        expect(yield* alive.reapRun(parkedRun.id, yield* reapPatch(yield* ABANDONED))).toBeNull();
        const reaped = yield* alive.reapRun(streamingRun.id, yield* reapPatch(yield* ABANDONED));
        expect(reaped?.id).toBe(streamingRun.id);
        expect(reaped?.streamTail).toEqual([entry('shown-tail')]);
        expect(yield* dead.isRunning(parkedRun.id)).toBe(true);
        expect(yield* dead.isRunning(streamingRun.id)).toBe(false);
        yield* alive.markSettledNotified(streamingRun.id, new Date(yield* Clock.currentTimeMillis), reaped?.settledNotification ?? null);
        expect(
          yield* alive.claimSettledForNotification({
            heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 60_000),
            now: new Date(yield* Clock.currentTimeMillis),
            limit: 10,
            maxAttempts: 10,
          }),
        ).toEqual({ claims: [], exhausted: [] });
      }),
    );
    test(
      'a foreign run that is still beating is not takeable; the same run is once it goes silent',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const working = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const booting = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(working.createRun(startInput(thread)));
        yield* working.writeHeartbeats([run.id], new Date(yield* Clock.currentTimeMillis));
        const beating = { kind: 'foreign-owner' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) - 60_000) };
        expect(yield* booting.reapableRuns(beating)).toHaveLength(0);
        expect(yield* booting.reapRun(run.id, yield* reapPatch(beating))).toBeNull();
        expect(yield* booting.adoptRun(run.id, { ...(yield* adoptInput(2)), selector: beating })).toBeNull();
        expect(yield* working.isRunning(run.id)).toBe(true);
        expect((yield* booting.reapableRuns(yield* ABANDONED)).map((row) => row.id)).toEqual([run.id]);
        expect((yield* booting.adoptRun(run.id, yield* adoptInput(2)))?.ownerId).toBe(INSTANCE);
      }),
    );
    test(
      'heartbeats and abandoned searches exclude idle and settled threads',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const working = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const booting = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const going = [];
        for (let index = 0; index < 2; index += 1) {
          going.push(yield* started(working.createRun(startInput(yield* harness.createThread({ ownerId: OWNER, scope: SCOPE })))));
        }
        const idle = Effect.fnUntraced(function* (count: number) {
          for (let index = 0; index < count; index += 1) {
            const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
            if (index % 2 === 0)
              yield* working.settleRun((yield* started(working.createRun(startInput(thread)))).id, yield* settlePatch('completed'));
          }
        });
        const ids = going.map((run) => run.id).sort();
        const beating = { kind: 'foreign-owner' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) - 60_000) };
        const found = () =>
          Effect.flatMap(ABANDONED, (selector) => Effect.map(booting.reapableRuns(selector), (rows) => rows.map((row) => row.id).sort()));
        yield* idle(2);
        expect(yield* found()).toEqual(ids);
        yield* working.writeHeartbeats(ids, new Date(yield* Clock.currentTimeMillis));
        expect(yield* booting.reapableRuns(beating)).toHaveLength(0);
        expect(
          yield* booting.reapableRuns({ kind: 'foreign-owner', heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 60_000) }),
        ).toHaveLength(2);
      }),
    );
    test(
      'a handed-over row is adoptable at once, and a cut is an ending of its own',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const leaving = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const booting = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(leaving.createRun(startInput(thread)));
        yield* leaving.writeHeartbeats([run.id], new Date(yield* Clock.currentTimeMillis));
        const silent = { kind: 'foreign-owner' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) - 60_000) };
        expect(yield* booting.reapableRuns(silent)).toHaveLength(0);
        expect(yield* booting.reapableRuns({ kind: 'handed-over' })).toHaveLength(0);
        const at = new Date(yield* Clock.currentTimeMillis);
        yield* leaving.handOverRuns([run.id], at);
        yield* leaving.handOverRuns([run.id], new Date(at.getTime() + 60_000));
        const stamped = yield* booting.latestRun(thread.id);
        expect(stamped?.status).toBe('running');
        expect(stamped?.handedOverAt?.getTime()).toBe(at.getTime());
        expect(yield* booting.reapableRuns(silent)).toHaveLength(0);
        const listed = yield* booting.reapableRuns({ kind: 'handed-over' });
        expect(listed.map((row) => row.id)).toEqual([run.id]);
        expect(listed[0]?.handedOverAt?.getTime()).toBe(at.getTime());
        const cut = yield* booting.cutRun(run.id, {
          selector: { kind: 'handed-over' },
          progress: { stage: 'cut', message: 'The process driving this run left before it finished.' },
          finishedAt: new Date(yield* Clock.currentTimeMillis),
        });
        expect(cut).toMatchObject({ id: run.id, status: 'cut', ownerId: INSTANCE, failureReason: null, failure: null });
        expect(yield* booting.isRunning(run.id)).toBe(false);
        const claimed = yield* booting.claimSettledForNotification({
          heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 1),
          now: new Date(yield* Clock.currentTimeMillis),
          limit: 10,
          maxAttempts: 3,
        });
        expect(claimed.claims.map((row) => row.id)).toContain(run.id);
      }),
    );
    test(
      'a departing owner hands over a running row whose stop still stands, and the next owner finds it with that stop at once',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const leaving = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const booting = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(leaving.createRun(startInput(thread)));
        const stop = { by: 'reader' as const, marker: true, withdraw: false };
        yield* leaving.requestStop(run.id, stop, new Date(yield* Clock.currentTimeMillis));
        yield* leaving.handOverRuns([run.id], new Date(yield* Clock.currentTimeMillis));
        expect((yield* booting.reapableRuns({ kind: 'handed-over' })).map((row) => [row.id, row.stopRequest?.by])).toEqual([
          [run.id, 'reader'],
        ]);
      }),
    );
    test(
      'adoption consumes the stamp: a third owner cannot take or cut the adopted run, and the adopter re-stamps',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const leaving = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const adopter = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const third = harness.runs({ ownerId: 'instance-3', scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(leaving.createRun(startInput(thread)));
        yield* leaving.handOverRuns([run.id], new Date(yield* Clock.currentTimeMillis));
        const adopted = yield* adopter.adoptRun(run.id, { ...(yield* adoptInput(2)), selector: { kind: 'handed-over' } });
        expect(adopted?.ownerId).toBe(INSTANCE);
        expect((yield* adopter.latestRun(thread.id))?.handedOverAt).toBeNull();
        yield* adopter.writeHeartbeats([run.id], new Date(yield* Clock.currentTimeMillis));
        const silent = { kind: 'foreign-owner' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) - 60_000) };
        expect(yield* third.reapableRuns({ kind: 'handed-over' })).toHaveLength(0);
        expect(yield* third.reapableRuns(silent)).toHaveLength(0);
        expect(yield* third.adoptRun(run.id, { ...(yield* adoptInput(5)), selector: { kind: 'handed-over' } })).toBeNull();
        expect(
          yield* third.cutRun(run.id, {
            selector: { kind: 'handed-over' },
            progress: { stage: 'cut', message: 'no' },
            finishedAt: new Date(yield* Clock.currentTimeMillis),
          }),
        ).toBeNull();
        expect(yield* adopter.isRunning(run.id)).toBe(true);
        const later = new Date(yield* Clock.currentTimeMillis);
        yield* adopter.handOverRuns([run.id], later);
        expect((yield* third.latestRun(thread.id))?.handedOverAt?.getTime()).toBe(later.getTime());
        expect((yield* third.reapableRuns({ kind: 'handed-over' })).map((row) => row.id)).toEqual([run.id]);
      }),
    );
    test(
      'a bill is added, never overwritten, and two adds land as their sum',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const bill = (n: number) => new Usage({ inputTokens: n, outputTokens: 1, totalTokens: n + 1 });
        const at = new Date(yield* Clock.currentTimeMillis);
        yield* Effect.all([runs.addUsage(run.id, bill(100), at), runs.addUsage(run.id, bill(200), at)], { concurrency: 2 });
        expect((yield* runs.latestRun(thread.id))?.usage).toMatchObject({ inputTokens: 300, outputTokens: 2, totalTokens: 302 });
      }),
    );
    test(
      'adoption hands a dead instance`s run to the resumer: ownership, budget, tail consumed once',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(dead.createRun(startInput(thread)));
        yield* dead.writeStreamTail(run.id, [entry('torn-tail')], new Date(yield* Clock.currentTimeMillis));
        const adopted = yield* alive.adoptRun(run.id, yield* adoptInput(1));
        expect(adopted?.ownerId).toBe(INSTANCE);
        expect(adopted?.resumes).toBe(1);
        expect(adopted?.streamTail).toEqual([entry('torn-tail')]);
        expect(yield* alive.isRunning(run.id)).toBe(true);
        const row = yield* alive.latestRun(thread.id);
        expect(row?.streamTail).toBeNull();
        expect(row?.resumes).toBe(1);
        expect(yield* alive.adoptRun(run.id, yield* adoptInput(2))).toBeNull();
        expect(yield* dead.isRunning(run.id)).toBe(false);
        yield* dead.writeStreamTail(run.id, [entry('from-the-old-owner')], new Date(yield* Clock.currentTimeMillis));
        yield* dead.writeProgress(run.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        expect(yield* dead.settleRun(run.id, yield* settlePatch('completed'))).toBeNull();
        const fenced = yield* alive.latestRun(thread.id);
        expect(fenced?.streamTail).toBeNull();
        expect(fenced?.status).toBe('running');
        expect(fenced?.ownerId).toBe(INSTANCE);
      }),
    );
    test(
      'a stop ends a running row whoever`s name is on it, once, and the row becomes the stopper`s',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(dead.createRun(startInput(thread)));
        yield* dead.writeStreamTail(run.id, [entry('shown-tail')], new Date(yield* Clock.currentTimeMillis));
        yield* dead.writeProgress(run.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        const stopped = yield* alive.stopRun(run.id, yield* stopPatch('reader'));
        expect(stopped).toMatchObject({ id: run.id, status: 'aborted', ownerId: INSTANCE, settledBy: 'reader', failureReason: null });
        expect(stopped?.streamTail).toEqual([entry('shown-tail')]);
        expect((yield* alive.latestRun(thread.id))?.streamTail).toBeNull();
        expect(yield* dead.isRunning(run.id)).toBe(false);
        expect(yield* alive.stopRun(run.id, yield* stopPatch('reader'))).toBeNull();
        const claimed = yield* alive.claimSettledForNotification({
          heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 1),
          now: new Date(yield* Clock.currentTimeMillis),
          limit: 10,
          maxAttempts: 3,
        });
        expect(claimed.claims.map((row) => row.id)).toContain(run.id);
        const elsewhere = harness.runs({ ownerId: OTHER_INSTANCE, scope: OTHER_SCOPE });
        const foreign = yield* started(
          elsewhere.createRun(startInput(yield* harness.createThread({ ownerId: OWNER, scope: OTHER_SCOPE }))),
        );
        expect(yield* alive.stopRun(foreign.id, yield* stopPatch('reader'))).toBeNull();
        expect(yield* elsewhere.isRunning(foreign.id)).toBe(true);
      }),
    );
    test(
      'the resume budget refuses the next death, and parked or settled rows are never adopted',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const spent = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const parked = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const spentRun = yield* started(dead.createRun(startInput(spent)));
        const parkedRun = yield* started(dead.createRun(startInput(parked)));
        yield* dead.writeProgress(parkedRun.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        expect((yield* alive.adoptRun(spentRun.id, yield* adoptInput(1)))?.resumes).toBe(1);
        const thirdInstance = harness.runs({ ownerId: 'instance-3', scope: SCOPE });
        expect(yield* thirdInstance.adoptRun(spentRun.id, yield* adoptInput(1))).toBeNull();
        yield* alive.handOverRuns([spentRun.id], new Date(yield* Clock.currentTimeMillis));
        expect(yield* thirdInstance.adoptRun(spentRun.id, { ...(yield* adoptInput(1)), selector: { kind: 'handed-over' } })).toMatchObject({
          id: spentRun.id,
          resumes: 1,
        });
        expect(yield* dead.adoptRun(spentRun.id, yield* adoptInput(1))).toBeNull();
        expect((yield* dead.reapRun(spentRun.id, yield* reapPatch(yield* ABANDONED)))?.id).toBe(spentRun.id);
        expect(yield* thirdInstance.adoptRun(spentRun.id, yield* adoptInput(10))).toBeNull();
        expect(yield* alive.adoptRun(parkedRun.id, yield* adoptInput(1))).toBeNull();
      }),
    );
    test.each(['output', 'step', 'fact', 'report'])(
      'durable %s renews the crash recovery budget, while setup and heartbeat do not',
      Effect.fnUntraced(function* (progress) {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const alive = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const third = harness.runs({ ownerId: 'instance-3', scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(dead.createRun(startInput(thread)));
        expect((yield* alive.adoptRun(run.id, yield* adoptInput(1)))?.resumes).toBe(1);
        yield* alive.writeHeartbeats([run.id], new Date(yield* Clock.currentTimeMillis));
        yield* alive.writeProgress(run.id, { stage: THREAD_RUN_RESUMING_STAGE, message: null }, new Date(yield* Clock.currentTimeMillis));
        yield* alive.writeStreamTail(run.id, null, new Date(yield* Clock.currentTimeMillis));
        yield* dead.writeStreamTail(run.id, [entry('displaced')], new Date(yield* Clock.currentTimeMillis));
        expect((yield* alive.latestRun(thread.id))?.resumes).toBe(1);
        expect(yield* third.adoptRun(run.id, yield* adoptInput(1))).toBeNull();
        if (progress === 'output') yield* alive.writeStreamTail(run.id, [entry('new-output')], new Date(yield* Clock.currentTimeMillis));
        else if (progress === 'step')
          yield* alive.addUsage(run.id, new Usage({ inputTokens: 1, outputTokens: 1 }), new Date(yield* Clock.currentTimeMillis));
        else if (progress === 'report')
          yield* alive.writeStreamTail(run.id, null, new Date(yield* Clock.currentTimeMillis), undefined, true);
        else
          yield* alive.writeProgress(
            run.id,
            { stage: 'streaming', message: null },
            new Date(yield* Clock.currentTimeMillis),
            undefined,
            true,
          );
        expect((yield* alive.latestRun(thread.id))?.resumes).toBe(0);
        expect(yield* third.adoptRun(run.id, yield* adoptInput(1))).toMatchObject({ id: run.id, ownerId: 'instance-3', resumes: 1 });
      }),
    );
    test(
      'an answer may only act on a run reserved from the awaiting stage',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const resume = {
          threadId: thread.id,
          runId: run.id,
          progress: { stage: THREAD_RUN_RESUMING_STAGE as RunStage, message: null },
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
        };
        expect(yield* Effect.flip(runs.resumeAwaitingRun(resume))).toBeInstanceOf(ThreadRunConflictError);
        yield* runs.writeProgress(run.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        const answers = yield* Effect.all([Effect.result(runs.resumeAwaitingRun(resume)), Effect.result(runs.resumeAwaitingRun(resume))], {
          concurrency: 2,
        });
        expect(answers.filter(Result.isSuccess)).toHaveLength(1);
      }),
    );
    test(
      'the running rows of one instance are answered for a whole list at once',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const parker = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const answerer = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const first = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const second = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const third = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const kept = yield* started(parker.createRun(startInput(first)));
        const taken = yield* started(parker.createRun(startInput(second)));
        const settled = yield* started(parker.createRun(startInput(third)));
        yield* parker.writeProgress(taken.id, AWAITING, new Date(yield* Clock.currentTimeMillis));
        expect([...(yield* parker.runningHere([kept.id, taken.id, settled.id, 'run-nobody-minted']))].sort()).toEqual(
          [kept.id, settled.id, taken.id].sort(),
        );
        yield* answerer.resumeAwaitingRun({
          threadId: second.id,
          runId: taken.id,
          progress: { stage: THREAD_RUN_RESUMING_STAGE as RunStage, message: null },
          heartbeatAt: new Date(yield* Clock.currentTimeMillis),
        });
        yield* parker.settleRun(settled.id, yield* settlePatch('completed'));
        expect(yield* parker.runningHere([kept.id, taken.id, settled.id])).toEqual([kept.id]);
        expect(yield* answerer.runningHere([kept.id, taken.id, settled.id])).toEqual([taken.id]);
        expect(yield* parker.runningHere([])).toEqual([]);
      }),
    );
    test(
      'staleness is measured by the caller`s clock, never the engine`s',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const beat = new Date(0);
        yield* runs.writeHeartbeats([run.id], beat);
        expect(yield* runs.reapableRuns({ kind: 'stale-heartbeat', heartbeatBefore: beat })).toHaveLength(0);
        expect(yield* runs.reapRun(run.id, yield* reapPatch({ kind: 'stale-heartbeat', heartbeatBefore: beat }))).toBeNull();
        const stale = { kind: 'stale-heartbeat' as const, heartbeatBefore: new Date(beat.getTime() + 1) };
        expect((yield* runs.reapableRuns(stale)).map((row) => row.id)).toEqual([run.id]);
        expect((yield* runs.reapRun(run.id, yield* reapPatch(stale)))?.id).toBe(run.id);
        expect(yield* runs.isRunning(run.id)).toBe(false);
      }),
    );
    test(
      'reaping and claiming never reach another scope`s runs',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const mine = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const foreign = harness.runs({ ownerId: OTHER_INSTANCE, scope: OTHER_SCOPE });
        const foreignThread = yield* harness.createThread({ ownerId: OWNER, scope: OTHER_SCOPE });
        const foreignRun = yield* started(foreign.createRun(startInput(foreignThread)));
        expect(yield* mine.reapableRuns(yield* ABANDONED)).toHaveLength(0);
        expect(yield* mine.reapRun(foreignRun.id, yield* reapPatch(yield* ABANDONED))).toBeNull();
        expect(yield* foreign.isRunning(foreignRun.id)).toBe(true);
        yield* foreign.settleRun(foreignRun.id, { ...(yield* settlePatch('completed')), heartbeatAt: new Date(0) });
        const claim = { heartbeatBefore: new Date(1), now: new Date(1), limit: 10, maxAttempts: 10 };
        expect((yield* mine.claimSettledForNotification(claim)).claims).toHaveLength(0);
        expect((yield* foreign.claimSettledForNotification(claim)).claims).toHaveLength(1);
      }),
    );
    test(
      'a run id that already stands is refused before anything changes',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* started(runs.createRun({ ...startInput(thread), runId: 'run-minted-by-the-caller' }));
        yield* runs.settleRun(first.id, yield* settlePatch('completed'));
        expect(yield* Effect.flip(started(runs.createRun({ ...startInput(thread), runId: first.id })))).toBeInstanceOf(ThreadStorageFailed);
        const standing = yield* runs.runsOf(thread.id);
        expect(standing.map((row) => [row.id, row.status])).toEqual([[first.id, 'completed']]);
        expect(yield* runs.latestRun(thread.id, ['running'])).toBeNull();
      }),
    );
    test(
      'the stream tail is one slot: overwritten in place, consumed by the settling write exactly once',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        yield* runs.writeStreamTail(
          run.id,
          [{ type: 'message', id: 'tail', role: 'assistant', text: 'half a par' }],
          new Date(yield* Clock.currentTimeMillis),
        );
        yield* runs.writeStreamTail(
          run.id,
          [{ type: 'message', id: 'tail', role: 'assistant', text: 'half a paragraph' }],
          new Date(yield* Clock.currentTimeMillis),
        );
        const refusal = new SettleRefused({});
        expect(
          yield* Effect.flip(
            harness.aggregate.transaction(
              Effect.fnUntraced(function* (tx) {
                yield* runs.settleRun(run.id, yield* settlePatch('aborted'), tx);
                return yield* refusal;
              }),
            ),
          ),
        ).toBe(refusal);
        expect(yield* runs.isRunning(run.id)).toBe(true);
        expect((yield* runs.latestRun(thread.id))?.streamTail).toEqual([
          { type: 'message', id: 'tail', role: 'assistant', text: 'half a paragraph' },
        ]);
        const settled = yield* runs.settleRun(run.id, yield* settlePatch('aborted'));
        expect(settled?.streamTail).toEqual([{ type: 'message', id: 'tail', role: 'assistant', text: 'half a paragraph' }]);
        expect((yield* runs.latestRun(thread.id))?.streamTail).toBeNull();
        expect(yield* runs.settleRun(run.id, yield* settlePatch('aborted'))).toBeNull();
      }),
    );
  });
}
