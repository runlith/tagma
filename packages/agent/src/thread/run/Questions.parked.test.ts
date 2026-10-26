import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentToolResolution } from '../../agent/door/types';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { entryOf } from '../../transcript/kinds';
import { USER_QUESTION_TOOL_NAME } from '../../transcript/parts';
import { ThreadCallBroke, threadCauseOf } from '../ThreadBorder';
import { parkedQuestions } from '../conformance/parkedQuestions';
import { ThreadInteractionConflictError } from './ThreadQuestion';
import { withinOf } from './ParkedQuestions';
import { emptyToolOutputs } from '../conformance/runCycle/runDoubles';
describe('parked native questions', () => {
  it.effect('a cleared question replays its typed refusal from the record after its waiter is gone', () =>
    Effect.gen(function* () {
      const world = yield* parkedQuestions();
      const refusal = { code: 'contributor-absent', reason: 'The source was withdrawn.' };
      const asking = {
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        compose: () => Effect.succeed(approvingQuestion()),
      };
      const first = yield* world.questions.ask({
        ...asking,
        stopped: Effect.succeed({ toolCallId: 'call-1', reason: refusal.reason, refusal }),
      });
      expect(first).toEqual({ kind: 'cleared', reason: refusal.reason, refusal });
      const replay = yield* world.questions.ask({ ...asking, compose: () => Effect.die('A settled question cannot be composed again') });
      expect(replay).toEqual(first);
      expect((yield* world.entries())?.filter(entryOf('question'))).toMatchObject([{ status: 'cleared', outcome: first }]);
    }),
  );
  it.effect('closing a parked question restores the standalone approval it displaced', () =>
    Effect.gen(function* () {
      const world = yield* parkedQuestions();
      yield* world.questions.approve({
        threadId: 'thread-1',
        key: 'standalone',
        operation: 'bash',
        summary: 'Run a command',
        asked: ['review'],
        withinMs: null,
        waitMs: 0,
      });
      const standalone = (yield* world.questions.open('thread-1'))[0]!;
      expect((yield* world.pending())?.questionId).toBe(standalone.questionId);
      yield* world.park(openQuestion());
      expect((yield* world.pending())?.questionId).toBe('q-1');
      yield* world.close('run-1');
      expect((yield* world.pending())?.questionId).toBe(standalone.questionId);
      yield* world.questions.answer('thread-1', standalone.questionId, []);
      expect(yield* world.pending()).toBeNull();
    }),
  );
  it.effect('an unknown question refuses without claiming another parked question', () =>
    Effect.gen(function* () {
      const world = yield* parkedQuestions();
      yield* world.seed({ ...openQuestion(), questionId: 'q-2' });
      const failure = threadCauseOf(yield* Effect.flip(world.answer([])));
      expect(failure).toMatchObject({ _tag: 'ThreadQuestionNotFound', threadId: 'thread-1', questionId: 'q-1' });
      expect((yield* world.pending())?.questionId).toBe('q-2');
    }),
  );
  it.effect(
    'a typed failure inside its claim clears the question with an unsettled tool outcome',
    Effect.fnUntraced(function* () {
      const failure = new ThreadCallBroke({ cause: new Error('door-failed') });
      const world = yield* parkedQuestions({ toolDoor: () => Effect.fail(failure) });
      yield* world.seed(openQuestion());
      expect(yield* Effect.flip(world.answer([{ questionId: 'q-1', values: ['yes'] }]))).toBe(failure);
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('tool')).map((entry) => entry.toolState)).toEqual(['output-error']);
      expect(entries.filter(entryOf('question')).map((entry) => entry.status)).toEqual(['cleared']);
    }),
  );
  it.effect(
    'a defect inside its claim clears the question with an unsettled tool outcome',
    Effect.fnUntraced(function* () {
      const defect = new Error('door-defect');
      const world = yield* parkedQuestions({ toolDoor: () => Effect.die(defect) });
      yield* world.seed(openQuestion());
      const exit = yield* Effect.exit(world.answer([{ questionId: 'q-1', values: ['yes'] }]));
      if (!Exit.isFailure(exit)) return yield* Effect.die('Expected the defect');
      expect(Cause.squash(exit.cause)).toBe(defect);
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('tool')).map((entry) => entry.toolState)).toEqual(['output-error']);
      expect(entries.filter(entryOf('question')).map((entry) => entry.status)).toEqual(['cleared']);
    }),
  );
  it.effect(
    'an interruption without a run stop clears the question as unsettled',
    Effect.fnUntraced(function* () {
      const world = yield* parkedQuestions({ toolDoor: () => Effect.interrupt });
      yield* world.seed(openQuestion());
      const exit = yield* Effect.exit(world.answer([{ questionId: 'q-1', values: ['yes'] }]));
      if (!Exit.isFailure(exit)) return yield* Effect.die('Expected interruption');
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('tool')).map((entry) => entry.toolState)).toEqual(['output-error']);
      expect(entries.filter(entryOf('question')).map((entry) => entry.status)).toEqual(['cleared']);
    }),
  );
  it.effect(
    'an unclaimed question cancels only when its own run closes',
    Effect.fnUntraced(function* () {
      const world = yield* parkedQuestions({ toolDoor: () => Effect.die('Closing builds no door') });
      yield* world.seed(openQuestion());
      yield* world.close('run-2');
      expect((yield* world.pending())?.status).toBe('open');
      expect(yield* world.log.headPosition('thread-1')).toBe(0);
      yield* world.close('run-1');
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('tool')).map((entry) => entry.toolState)).toEqual(['output-cancelled']);
      expect(entries.filter(entryOf('question')).map((entry) => entry.status)).toEqual(['cleared']);
    }),
  );
  it.effect(
    'expiry refuses the unanswered call and hands its run back for resumption',
    Effect.fnUntraced(function* () {
      const world = yield* parkedQuestions({ toolDoor: () => Effect.die('Expiry builds no door') });
      yield* world.park({ ...openQuestion(), toolCalls: [{ toolCallId: 'call-1', toolName: 'stage_all' }] });
      expect((yield* world.log.eventsAfter('thread-1', 0, 3)).map((event) => event.payload.entry)).toMatchObject([
        { type: 'question', questionId: 'q-1', status: 'open' },
      ]);
      yield* TestClock.adjust('119 seconds');
      expect((yield* world.pending())?.status).toBe('open');
      expect(yield* Queue.size(world.resumed)).toBe(0);
      yield* TestClock.adjust('1 second');
      const resumed = yield* Queue.take(world.resumed);
      expect(resumed.relaunch).toMatchObject({
        thread: { id: 'thread-1' },
        questionResult: {
          results: [
            {
              toolCallId: 'call-1',
              outcome: {
                kind: 'denied',
                output: { status: 'refused', code: 'unanswered', questionId: 'q-1', askedOf: 'operator', timeoutMs: 120_000 },
              },
            },
          ],
        },
      });
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('tool')).map((entry) => entry.toolState)).toEqual(['output-denied']);
      expect(entries.filter(entryOf('question'))).toMatchObject([{ status: 'lapsed', updatedAt: new Date(120_000).toISOString() }]);
      expect((yield* world.log.eventsAfter('thread-1', 0, 3)).map((event) => event.payload.entry)).toMatchObject([
        { type: 'question', questionId: 'q-1', status: 'open' },
        { type: 'tool', toolCallId: 'call-1', toolState: 'output-denied' },
        { type: 'question', questionId: 'q-1', status: 'lapsed' },
      ]);
    }),
  );
  it.effect(
    'concurrent equal answers share the outcome and a different answer refuses typed',
    Effect.fnUntraced(function* () {
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const world = yield* parkedQuestions({
        toolDoor: (door) => Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(gate), door)),
      });
      yield* world.seed(approvingQuestion());
      const answers = [{ questionId: 'call-1', values: ['go'] }];
      const first = yield* Effect.forkScoped(world.answer(answers));
      yield* Deferred.await(entered);
      const second = yield* Effect.forkScoped(world.answer(answers), { startImmediately: true });
      const different = yield* Effect.flip(world.answer([{ questionId: 'call-1', values: ['stop'] }]));
      const conflict = threadCauseOf(different);
      expect(conflict).toBeInstanceOf(ThreadInteractionConflictError);
      if (!(conflict instanceof ThreadInteractionConflictError)) return yield* Effect.die('Expected a conflict');
      expect({ threadId: conflict.threadId, runId: conflict.runId, questionId: conflict.questionId }).toEqual({
        threadId: 'thread-1',
        runId: 'run-1',
        questionId: 'q-1',
      });
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(first)).toEqual({ runId: 'run-1' });
      expect(yield* Fiber.join(second)).toEqual({ runId: 'run-1' });
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('question')).map((entry) => entry.status)).toEqual(['answered']);
      expect(yield* world.log.headPosition('thread-1')).toBe(2);
      expect(threadCauseOf(yield* Effect.flip(world.answer([{ questionId: 'call-1', values: ['stop'] }])))).toBeInstanceOf(
        ThreadInteractionConflictError,
      );
    }),
  );
  it.effect('an answer keeps its identity through disposal, completion and the next run', () =>
    Effect.gen(function* () {
      const disposing = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const world = yield* parkedQuestions({
        toolOutputs: {
          ...emptyToolOutputs,
          dispose: () => Effect.andThen(Deferred.succeed(disposing, undefined), Deferred.await(released)),
        },
      });
      yield* world.seed(approvingQuestion());
      const answers = [{ questionId: 'call-1', values: ['go'] }];
      const first = yield* Effect.forkScoped(world.answer(answers));
      yield* Deferred.await(disposing);
      const same = yield* Effect.forkScoped(world.answer(answers), { startImmediately: true });
      yield* Deferred.succeed(released, undefined);
      expect(yield* Fiber.join(first)).toEqual({ runId: 'run-1' });
      expect(yield* Fiber.join(same)).toEqual({ runId: 'run-1' });
      yield* world.runs.settleRun('run-1', {
        status: 'completed',
        progress: world.run.progress,
        finishedAt: new Date(0),
        heartbeatAt: new Date(0),
      });
      expect(threadCauseOf(yield* Effect.flip(world.answer(answers)))).toBeInstanceOf(ThreadInteractionConflictError);
      const thread = yield* world.aggregate.find('thread-1');
      if (thread === undefined) return yield* Effect.die('the answered thread disappeared');
      yield* world.runs.createRun({
        startFrom: thread,
        kind: 'turn',
        runId: 'run-2',
        approval: { mode: 'review', interactive: true },
        progress: world.run.progress,
      });
      expect(threadCauseOf(yield* Effect.flip(world.answer(answers)))).toBeInstanceOf(ThreadInteractionConflictError);
    }),
  );
  it.effect(
    'a question parked after bypass hands back the confirmed answer',
    Effect.fnUntraced(function* () {
      const world = yield* parkedQuestions();
      yield* world.bypass();
      yield* world.park(approvingQuestion());
      const resumed = yield* Queue.take(world.resumed);
      expect(resumed.relaunch).toMatchObject({
        thread: { id: 'thread-1' },
        questionResult: { results: [{ toolCallId: 'call-1', outcome: { kind: 'answered' } }] },
      });
      expect(yield* world.pending()).toBeNull();
      const entries = (yield* world.entries()) ?? [];
      expect(entries.filter(entryOf('question'))).toMatchObject([
        { status: 'answered', answers: [{ questionId: 'call-1', values: ['go'] }] },
      ]);
      expect((yield* world.log.eventsAfter('thread-1', 0, 3)).map((event) => event.payload.entry)).toMatchObject([
        { type: 'question', questionId: 'q-1', status: 'open' },
        { type: 'tool', toolCallId: 'call-1', toolState: 'output-available' },
        { type: 'question', questionId: 'q-1', status: 'answered' },
      ]);
    }),
  );
});
describe('the deadline a parked question declares', () => {
  const calls = [{ toolCallId: 'call-1' }, { toolCallId: 'call-sweep' }];
  const reader = (toolCallId: string, withinMs?: number): AgentToolResolution => ({
    toolCallId,
    name: toolCallId,
    input: {},
    generation: 0,
    preparation: { subjects: [], prepared: [] },
    reader: withinMs === undefined ? undefined : { withinMs },
  });
  test('is the shortest wait all its tools declared', () => {
    expect(withinOf({ toolCalls: calls }, [reader('call-1', 300_000), reader('call-sweep', 120_000)])).toBe(120_000);
  });
  test('waits without a deadline when a call has no declared limit', () => {
    expect(withinOf({ toolCalls: calls }, [reader('call-1'), reader('call-sweep', 120_000)])).toBeNull();
    expect(withinOf({ toolCalls: [] }, [])).toBeNull();
  });
});
function openQuestion(): ThreadQuestionEntry {
  return {
    type: 'question',
    id: 'q-entry-1',
    runId: 'run-1',
    questionId: 'q-1',
    questions: [],
    toolCalls: [{ toolCallId: 'call-1', toolName: USER_QUESTION_TOOL_NAME }],
    status: 'open',
    occurredAt: new Date(0).toISOString(),
  };
}
function approvingQuestion(): ThreadQuestionEntry {
  return {
    ...openQuestion(),
    questions: [{ id: 'call-1', toolCallId: 'call-1', prompt: 'Go on?', options: [{ value: 'go', label: 'Go' }], approves: 'go' }],
  };
}
