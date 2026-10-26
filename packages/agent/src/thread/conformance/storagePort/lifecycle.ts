import { describe, expect } from 'bun:test';
import type { Test } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, type Scope } from 'effect';
import type { ThreadWriteTx } from '../../ThreadPorts';
import { ThreadRunKeyReusedError } from '../../storage/runs';
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
  reapPatch,
  settlePatch,
  started,
  startInput,
  stopPatch,
} from './support';
const BY_READER = { by: 'reader' as const, marker: true, withdraw: false };
export function describeThreadLifecyclePort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Test<Scope.Scope | R>,
): void {
  describe(`${name}: thread run lifecycle rows`, () => {
    test(
      'a start key that stands answers its run before any running one refuses, and other content under it is refused',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* started(runs.createRun({ ...startInput(thread), startKey: { key: 'turn-1', digest: 'digest-a' } }));
        expect(yield* runs.createRun({ ...startInput(thread), startKey: { key: 'turn-1', digest: 'digest-a' } })).toMatchObject({
          _tag: 'Replayed',
          run: { id: first.id, status: 'running' },
        });
        const reused = yield* Effect.flip(runs.createRun({ ...startInput(thread), startKey: { key: 'turn-1', digest: 'digest-b' } }));
        expect(reused).toBeInstanceOf(ThreadRunKeyReusedError);
        expect(reused).toMatchObject({ runId: first.id });
        expect((yield* runs.runByStartKey(thread.id, 'turn-1'))?.id).toBe(first.id);
        expect((yield* runs.runsOf(thread.id)).map((run) => run.id)).toEqual([first.id]);
      }),
    );
    test(
      'a stop and a completion racing over one run end it exactly once, as the winner wrote it',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(runs.createRun(startInput(thread)));
        const [completed, stopped] = yield* Effect.all(
          [runs.settleRun(run.id, yield* settlePatch('completed')), runs.stopRun(run.id, yield* stopPatch('reader'))],
          { concurrency: 2 },
        );
        const winners = [completed, stopped].filter((row) => row !== null);
        expect(winners).toHaveLength(1);
        expect((yield* runs.runById(run.id))?.status).toBe(winners[0]!.status);
      }),
    );
    test(
      'a tail queued on a write unit runs once after the unit commits, sees its writes, never runs when the unit turns back, and is refused once the unit ended',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const seen: string[] = [];
        const queue = (tx: TWrite, name: string) => (tx as unknown as ThreadWriteTx).afterCommit(Effect.sync(() => void seen.push(name)));
        const ended = yield* Deferred.make<TWrite>();
        const row = yield* harness.aggregate.transaction(
          Effect.fnUntraced(function* (tx) {
            yield* Deferred.succeed(ended, tx);
            const inserted = yield* harness.aggregate.insert({ ownerId: OWNER, agentId: 'agent' }, tx);
            yield* (tx as unknown as ThreadWriteTx).afterCommit(
              Effect.orDie(harness.aggregate.find(inserted.id)).pipe(
                Effect.andThen((found) => Effect.sync(() => void seen.push(found === undefined ? 'invisible' : 'visible'))),
              ),
            );
            yield* queue(tx, 'second');
            seen.push('body');
            return inserted;
          }),
        );
        expect(seen).toEqual(['body', 'visible', 'second']);
        expect((yield* harness.aggregate.find(row.id))?.id).toBe(row.id);
        expect(Exit.isFailure(yield* Effect.exit(queue(yield* Deferred.await(ended), 'late')))).toBe(true);
        seen.length = 0;
        const turnedBack = harness.aggregate.transaction((tx) => Effect.andThen(queue(tx, 'dropped'), Effect.fail('turned back' as const)));
        expect(yield* Effect.flip(turnedBack)).toBe('turned back');
        expect(seen).toEqual([]);
      }),
    );
    test(
      'a write unit that turns back or is interrupted leaves none of its writes, and its refusal reaches the caller as that value',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const refusal = { _tag: 'Refused' as const };
        const inserted: string[] = [];
        const insert = (tx: TWrite) =>
          harness.aggregate
            .insert({ ownerId: OWNER, agentId: 'agent' }, tx)
            .pipe(Effect.tap((row) => Effect.sync(() => void inserted.push(row.id))));
        const failed = yield* Effect.flip(harness.aggregate.transaction((tx) => Effect.andThen(insert(tx), Effect.fail(refusal))));
        expect(failed).toBe(refusal);
        const written = yield* Deferred.make<void>();
        const interrupted = yield* Effect.gen(function* () {
          const unit = yield* Effect.forkChild(
            harness.aggregate.transaction((tx) =>
              Effect.andThen(insert(tx), Effect.andThen(Deferred.succeed(written, undefined), Effect.never)),
            ),
          );
          yield* Deferred.await(written);
          yield* Fiber.interrupt(unit);
          const ended = yield* Fiber.await(unit);
          return Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause);
        });
        expect(interrupted).toBe(true);
        expect(inserted).toHaveLength(2);
        for (const id of inserted) expect(yield* harness.aggregate.find(id)).toBeUndefined();
      }),
    );
    test(
      'a parked run is untouched by adoption, a cut and a reap, whoever asks',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const owner = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const peer = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(owner.createRun(startInput(thread)));
        yield* owner.writeProgress(run.id, AWAITING, new Date(0));
        const cut = {
          selector: yield* ABANDONED,
          progress: { stage: 'cut' as const, message: null },
          finishedAt: new Date(yield* Clock.currentTimeMillis),
        };
        const stale = { kind: 'stale-heartbeat' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 60_000) };
        expect(yield* peer.adoptRun(run.id, yield* adoptInput(10))).toBeNull();
        expect(yield* peer.cutRun(run.id, cut)).toBeNull();
        expect(yield* peer.reapRun(run.id, yield* reapPatch(yield* ABANDONED))).toBeNull();
        expect(yield* owner.reapRun(run.id, yield* reapPatch(stale))).toBeNull();
        expect(yield* owner.cutRun(run.id, { ...cut, selector: stale })).toBeNull();
        expect(yield* owner.runById(run.id)).toMatchObject({ status: 'running', ownerId: OTHER_INSTANCE, resumes: 0 });
      }),
    );
    test(
      'stop requests merge inside the write, and an ended or foreign run takes none',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const dead = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const peer = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const foreign = harness.runs({ ownerId: INSTANCE, scope: OTHER_SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const run = yield* started(dead.createRun(startInput(thread)));
        expect(yield* foreign.requestStop(run.id, BY_READER, new Date(1))).toBeNull();
        yield* Effect.all(
          [
            peer.requestStop(run.id, BY_READER, new Date(1)),
            peer.requestStop(run.id, { by: 'agent', marker: false, withdraw: true }, new Date(2)),
          ],
          { concurrency: 2 },
        );
        const standing = (yield* peer.runById(run.id))?.stopRequest ?? null;
        expect(standing).toMatchObject({ marker: true, withdraw: true });
        expect(standing?.by === 'reader' || standing?.by === 'agent').toBe(true);
        expect((yield* peer.reapableRuns(yield* ABANDONED)).map((row) => [row.id, row.stopRequest])).toEqual([[run.id, standing]]);
        yield* dead.settleRun(run.id, yield* settlePatch('completed'));
        expect(yield* peer.requestStop(run.id, BY_READER, new Date(3))).toBeNull();
        expect((yield* peer.runById(run.id))?.stopRequest).toEqual(standing);
      }),
    );
    test(
      'a standing stop refuses parking, resuming and adoption, and turns a reap into an abort by its stopper',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const runs = harness.runs({ ownerId: INSTANCE, scope: SCOPE });
        const peer = harness.runs({ ownerId: OTHER_INSTANCE, scope: SCOPE });
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const parked = yield* started(runs.createRun(startInput(thread)));
        expect(yield* runs.parkRun(parked.id, AWAITING, new Date(yield* Clock.currentTimeMillis))).toBe('parked');
        yield* runs.requestStop(parked.id, BY_READER, new Date(yield* Clock.currentTimeMillis));
        expect(
          yield* runs.resumeAwaitingRun({
            threadId: thread.id,
            runId: parked.id,
            progress: AWAITING,
            heartbeatAt: new Date(yield* Clock.currentTimeMillis),
          }),
        ).toBe('stopping');
        yield* runs.stopRun(parked.id, yield* stopPatch('reader'));
        const going = yield* started(runs.createRun(startInput(thread)));
        const stale = { kind: 'stale-heartbeat' as const, heartbeatBefore: new Date((yield* Clock.currentTimeMillis) + 60_000) };
        yield* runs.requestStop(going.id, BY_READER, new Date(yield* Clock.currentTimeMillis));
        expect(yield* runs.parkRun(going.id, AWAITING, new Date(yield* Clock.currentTimeMillis))).toBe('stopping');
        yield* runs.writeHeartbeats([going.id], new Date(0));
        expect(yield* peer.adoptRun(going.id, yield* adoptInput(10))).toBeNull();
        expect(yield* runs.reapRun(going.id, yield* reapPatch(stale))).toMatchObject({
          status: 'aborted',
          settledBy: 'reader',
          failureReason: null,
        });
      }),
    );
  });
}
