import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentToolResolution } from '../../agent/door/types';
import { ThreadOwner, ThreadRunStoreFactory } from '../ThreadPorts';
import { runRow } from '../conformance/runCycle/runDoubles';
import { runStore } from '../conformance/runCycle/store';
import { ApprovalParking, approvalParkingLayer } from './ApprovalParking';
import { QuestionDeadlines } from './QuestionDeadlines';
import { threadRunLedgerLayer } from './ThreadRunLedger';
const run1 = { id: 'run-1', threadId: 'thread-1' };
describe('ApprovalParking', () => {
  it.effect(
    'a question is taken once and replacement spends the earlier question',
    Effect.fnUntraced(function* () {
      const { parking } = yield* parkingOver(['run-1']);
      parking.hold(run1, 'question-1', [resolution('call-1')]);
      expect(parking.take('run-1', 'question-2')).toEqual([]);
      expect(parking.take('run-1', 'question-1')).toEqual([resolution('call-1')]);
      expect(parking.take('run-1', 'question-1')).toEqual([]);
      expect(parking.parked()).toEqual([]);
      parking.hold(run1, 'question-1', [resolution('call-1')]);
      parking.hold(run1, 'question-2', []);
      expect(parking.take('run-1', 'question-1')).toEqual([]);
      expect(parking.holds('run-1', 'question-2')).toBe(true);
    }),
  );
  it.effect(
    'the next parked question releases resolutions whose run moved to another owner',
    Effect.fnUntraced(function* () {
      const { parking, rows } = yield* parkingOver(['run-mine', 'run-taken', 'run-new']);
      parking.hold({ id: 'run-mine', threadId: 'thread-1' }, 'question-1', [resolution('call-1')]);
      parking.hold({ id: 'run-taken', threadId: 'thread-2' }, 'question-2', [resolution('call-2')]);
      const released = parking.released('run-taken', 'question-2');
      expect([...parking.parked()].sort()).toEqual(['run-mine', 'run-taken']);
      const taken = rows.get('run-taken');
      if (!taken) return yield* Effect.die('Expected the taken run');
      rows.set(taken.id, { ...taken, ownerId: 'another-owner' });
      parking.hold({ id: 'run-new', threadId: 'thread-3' }, 'question-3', []);
      yield* released;
      expect([...parking.parked()].sort()).toEqual(['run-mine', 'run-new']);
      expect(parking.take('run-mine', 'question-1')).toEqual([resolution('call-1')]);
    }),
  );
  it.effect(
    'releasing a run cancels its deadlines and completes its release watchers',
    Effect.fnUntraced(function* () {
      const { parking, deadlines } = yield* parkingOver(['run-1']);
      const fired = yield* Deferred.make<void>();
      parking.hold(run1, 'question-1', []);
      deadlines.arm({ runId: 'run-1', questionId: 'question-1', withinMs: 60_000 }, Effect.asVoid(Deferred.succeed(fired, undefined)));
      const released = yield* Effect.forkScoped(parking.released('run-1', 'question-1'), { startImmediately: true });
      expect(released.pollUnsafe()).toBeUndefined();
      parking.release('run-1');
      yield* Fiber.join(released);
      yield* TestClock.adjust('2 minutes');
      expect(yield* Deferred.isDone(fired)).toBe(false);
      expect(parking.parked()).toEqual([]);
    }),
  );
});
const parkingOver = Effect.fnUntraced(function* (running: readonly string[]) {
  const held = runStore(running.map((id) => runRow(id)));
  const context = yield* Layer.build(
    approvalParkingLayer.pipe(
      Layer.provideMerge(threadRunLedgerLayer),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ThreadOwner, { id: held.runs.ownerId }),
          Layer.succeed(ThreadRunStoreFactory, ThreadRunStoreFactory.of({ create: () => held.runs })),
        ),
      ),
    ),
  );
  return { parking: Context.get(context, ApprovalParking), deadlines: Context.get(context, QuestionDeadlines), rows: held.rows };
});
function resolution(toolCallId: string): AgentToolResolution {
  return {
    toolCallId,
    name: 'read_selection',
    input: { of: 'root-1' },
    generation: 0,
    preparation: { subjects: [{ kind: 'read', value: 'thread://owner/thread-a' }], prepared: ['thread-a'] },
  };
}
