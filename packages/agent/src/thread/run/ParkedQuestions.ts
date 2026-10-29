import { Cause, Clock, Deferred, Effect, Exit, Stream } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import type { AgentToolResolution, AgentToolStop } from '../../agent/door/types';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import { threadFailureMessage } from '../ThreadFailure';
import { ThreadNotFoundError } from '../storage/aggregate';
import { actDigest, callKey, type CallerKey, type Keyed } from '../keyed';
import { answerOf, transitionDeps, transitionNow } from '../transition/kernel';
import { ThreadActReusedError, ThreadActSpentError, type Decision } from '../transition/port';
import { runTransition, ThreadRunSequences } from '../transition/sequence';
import { threadGuidanceEvent, threadQuestionEvent } from '../events';
import { AgentGuidanceJournal, pendingRuntimeGuides } from '../../agent/AgentGuidanceJournal';
import type { AgentRuntimeGuidance, PendingRuntimeGuide } from '../../agent/contracts';
import { sealThreadEvents } from '../ThreadEventDoor';
import type { ThreadWriteTx } from '../ThreadPorts';
import { disposed, makeParkedDoors } from './parkedDoor';
import { makeParkedMoves } from './ParkedMoves';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../ThreadBorder';
import { ApprovalModes } from '../../modes/ApprovalModes';
import { RunLifecycle, type RunParked } from './lifecycle/RunLifecycle';
import { Approvers } from '../Approvers';
import { ApprovalParking } from './ApprovalParking';
import { QuestionDeadlines } from './QuestionDeadlines';
import { RunExecution, type RunResumption } from './RunExecution';
import type { RunNote } from './notes';
import { isOpenQuestion, slotAfter, slotWithout } from './pendingSlot';
import { announcedTo, routedTo } from './questionRouting';
import { routedEntry } from './routedQuestions';
import { RunScheduler, type ParkedResume } from './scheduler/RunScheduler';
import { type AskQuestion, QuestionIntake } from './scheduler/intake';
import {
  cancelledQuestion,
  refusedQuestion,
  ThreadInteractionConflictError,
  ThreadQuestionNotFound,
  questionGuidanceEvents,
  questionToolResultEvents,
  questionToolResults,
  toolMessageFromResults,
  unsettledQuestion,
} from './ThreadQuestion';
import { bypassedAnswers, toolCallsFromQuestion, unansweredResult } from './ToolQuestion';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
import { ThreadSnapshots } from './ThreadSnapshots';
import type { ThreadStreamQuestionResult } from './ThreadStreamSink';
import type { ThreadRunRow } from '../rows';
export const withinOf = (
  question: {
    readonly toolCalls: readonly {
      readonly toolCallId: string;
    }[];
  },
  resolutions: readonly AgentToolResolution[],
): number | null => {
  const waits = new Map(resolutions.map((resolution) => [resolution.toolCallId, resolution.reader?.withinMs]));
  const declared = question.toolCalls.map((call) => waits.get(call.toolCallId));
  if (declared.length === 0 || !declared.every((within): within is number => within !== undefined)) return null;
  return Math.min(...declared);
};
const untouched = { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
export const answerKey = (threadId: string, questionId: string, answers: readonly ThreadInteractionAnswer[], call: CallerKey): Keyed => ({
  evidence: { call: callKey({ operation: 'answer', ...call }) },
  digest: actDigest(['answer', threadId, questionId, answers]),
});
export const makeParkedQuestions = Effect.fnUntraced(function* (runMaintenance: (work: Effect.Effect<void>) => unknown, ask: AskQuestion) {
  const kernel = yield* transitionDeps;
  const sequences = yield* ThreadRunSequences;
  const parkedDoor = yield* makeParkedDoors;
  const ledger = yield* ThreadRunLedger;
  const scheduler = yield* RunScheduler;
  const parking = yield* ApprovalParking;
  const deadlines = yield* QuestionDeadlines;
  const snapshots = yield* ThreadSnapshots;
  const execution = yield* RunExecution;
  const approvers = yield* Approvers;
  const lifecycle = yield* RunLifecycle;
  const modes = yield* ApprovalModes;
  const { store } = kernel;
  const answering = new Set<string>();
  const offers = new Map<string, readonly (() => void)[]>();
  const retract = (runId: string): void => {
    for (const withdraw of offers.get(runId) ?? []) withdraw();
    offers.delete(runId);
  };
  const released = (runId: string): void => {
    parking.release(runId);
    retract(runId);
  };
  const resuming = new Map<
    string,
    {
      readonly given: string;
      readonly done: Deferred.Deferred<
        {
          runId: string;
        },
        ThreadBorderFailed
      >;
    }
  >();
  const maintain = (work: Effect.Effect<void, ThreadBorderFailed, QuestionIntake>): void => {
    runMaintenance(
      work.pipe(
        Effect.provideService(QuestionIntake, intake),
        Effect.exit,
        Effect.flatMap((exit) =>
          Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
            ? Effect.void
            : Effect.logWarning('parked question maintenance failed', Cause.pretty(exit.cause)),
        ),
      ),
    );
  };
  const moving = new Map<string, Set<Deferred.Deferred<void>>>();
  const moves = yield* makeParkedMoves({
    claim: (runId, questionId) => {
      const held = `${runId}\u0000${questionId}`;
      if (answering.has(held) || resuming.has(held)) return null;
      const done = Deferred.makeUnsafe<void>();
      const standing = moving.get(held) ?? new Set<Deferred.Deferred<void>>();
      standing.add(done);
      moving.set(held, standing);
      return () => {
        standing.delete(done);
        if (standing.size === 0 && moving.get(held) === standing) moving.delete(held);
        Deferred.doneUnsafe(done, Effect.void);
      };
    },
    released,
    maintain,
    ask,
    parkedDoor,
  });
  const conflict = (threadId: string, runId: string, questionId: string, reason?: string): ThreadCallBroke =>
    new ThreadCallBroke({ cause: new ThreadInteractionConflictError({ threadId, runId, questionId, reason }) });
  const waived = (run: ThreadRunRef, asked: ThreadQuestionEntry): void => {
    const answers = bypassedAnswers(asked);
    if (answers === null) return;
    maintain(
      Effect.gen(function* () {
        yield* execution.settled(run.id);
        const thread = yield* store.find(run.threadId);
        if (!thread) return;
        const mode = yield* modes.get(thread.authority.mode).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
        if (mode.confirmsWaiting !== true) return;
        yield* answer(run.threadId, asked.questionId, answers).pipe(
          Effect.asVoid,
          Effect.catchIf(
            (failure) => {
              const cause = threadCauseOf(failure);
              return cause instanceof ThreadInteractionConflictError || cause instanceof ThreadQuestionNotFound;
            },
            () => Effect.void,
          ),
        );
      }),
    );
  };
  const hold = (run: ThreadRunRef, question: ThreadQuestionEntry, door: AgentToolDoor): void => {
    const questionId = question.questionId;
    const toolCallIds = question.toolCalls.map((call) => call.toolCallId);
    const resolutions = door.resolutionsOf(toolCallIds);
    parking.hold(run, questionId, resolutions);
    if (moves !== null) {
      offers.set(
        run.id,
        toolCallsFromQuestion(question).map((call) =>
          door.parked(
            call.toolCallId,
            moves(
              run,
              questionId,
              call.toolCallId,
              resolutions.filter((resolution) => resolution.toolCallId === call.toolCallId),
            ).pipe(Effect.provideService(QuestionIntake, intake)),
          ),
        ),
      );
    }
    maintain(
      Effect.andThen(
        execution.settled(run.id),
        Stream.runForEach(door.callStops(toolCallIds), (called) =>
          parking.holds(run.id, questionId) ? Effect.uninterruptible(stop(run.threadId, run.id, questionId, called)) : Effect.void,
        ).pipe(Effect.raceFirst(parking.released(run.id, questionId))),
      ),
    );
    const withinMs = question.timeoutMs === undefined ? withinOf(question, resolutions) : question.timeoutMs;
    if (withinMs === null) return;
    deadlines.arm(
      { runId: run.id, questionId, withinMs, askedAt: question.occurredAt },
      Effect.suspend(() => (parking.holds(run.id, questionId) ? lapse(run.threadId, run.id, questionId, withinMs) : Effect.void)).pipe(
        Effect.provideService(QuestionIntake, intake),
      ),
    );
  };
  const written = (
    threadId: string,
    runId: string,
    question: ThreadQuestionEntry | null,
    untold: AgentRuntimeGuidance | null,
  ): Effect.Effect<void, ThreadBorderFailed> =>
    Effect.flatMap(
      runTransition<undefined, ThreadWriteTx>(
        kernel,
        sequences,
        { id: runId, threadId },
        {
          declared: question
            ? sealThreadEvents([threadQuestionEvent(question)])
            : untold === null
              ? []
              : sealThreadEvents([threadGuidanceEvent(untold)]),
          decide: Effect.fnUntraced(function* ({ row }, tx) {
            const pendingInteraction =
              question === null
                ? yield* slotWithout(store, threadId, row.pendingInteraction, runId, tx)
                : yield* slotAfter(store, threadId, row.pendingInteraction, question, 'parked', tx);
            return { apply: true, result: undefined, patch: { pendingInteraction } } as const;
          }),
        },
        ['completion', runId, question?.questionId ?? null],
      ),
      (outcome) => answerOf(threadId, outcome),
    ).pipe(
      Effect.tap(() =>
        question === null
          ? Effect.void
          : note<RunNote>(
              { type: 'question-asked', question: question.questionId, toolCalls: question.toolCalls.map((call) => call.toolCallId) },
              { run: question.runId },
            ),
      ),
      Effect.asVoid,
    );
  const clear = (
    threadId: string,
    runId: string,
    reason: string,
    ending: typeof cancelledQuestion = cancelledQuestion,
  ): Effect.Effect<void, ThreadBorderFailed> =>
    Effect.suspend(() => {
      let cleared: {
        readonly runId: string;
        readonly questionId: string;
      } | null = null;
      return transitionNow<undefined, ThreadWriteTx>(
        kernel,
        threadId,
        {
          declared: [],
          decide: Effect.fnUntraced(function* ({ row }, tx) {
            const question = row.pendingInteraction;
            if (!question || routedEntry(question)) return untouched;
            if (question.runId !== runId) return untouched;
            if (answering.has(`${question.runId}\u0000${question.questionId}`)) return untouched;
            const cancelled = ending(question, reason);
            cleared = { runId: cancelled.question.runId, questionId: cancelled.question.questionId };
            return {
              apply: true,
              result: undefined,
              events: [
                ...questionToolResultEvents(
                  yield* store.entriesOfRun(threadId, cancelled.question.runId, tx),
                  cancelled.question,
                  cancelled.results,
                ),
                threadQuestionEvent(cancelled.question, [cancelled.message]),
                ...questionGuidanceEvents(question),
              ],
              patch: { pendingInteraction: yield* slotAfter(store, threadId, question, cancelled.question, 'parked', tx) },
            } as Decision<undefined, ThreadWriteTx>;
          }),
        },
        { evidence: { decidedBy: `question:${runId}:clear` }, digest: actDigest(['question-clear', runId]) },
      ).pipe(
        Effect.catchTag('ThreadNotFound', () => Effect.void),
        Effect.tap(() => {
          const parked = cleared;
          if (parked === null) return Effect.void;
          released(parked.runId);
          return note<RunNote>({ type: 'question-answered', question: parked.questionId, outcome: 'cleared' }, { run: parked.runId });
        }),
        Effect.asVoid,
      );
    });
  const unavailable = Effect.fn('ParkedQuestions.unavailable')(function* (threadId: string, questionId: string, given: string) {
    const question = yield* store.questionById(threadId, questionId);
    if (question === undefined) return yield* new ThreadCallBroke({ cause: new ThreadQuestionNotFound({ threadId, questionId }) });
    const flying = resuming.get(`${question.runId}\u0000${questionId}`);
    if (flying !== undefined) {
      if (flying.given !== given) return yield* conflict(threadId, question.runId, questionId);
      return yield* Deferred.await(flying.done);
    }
    return yield* conflict(threadId, question.runId, questionId, 'This question is no longer answerable.');
  });
  const answer = Effect.fnUntraced(function* (
    threadId: string,
    questionId: string,
    answers: readonly ThreadInteractionAnswer[],
    call?: CallerKey,
  ): Effect.fn.Return<
    {
      runId: string;
    },
    ThreadBorderFailed,
    QuestionIntake
  > {
    if (call !== undefined) {
      const key = answerKey(threadId, questionId, answers, call);
      const reading = yield* kernel.transitions.readRecord(threadId, key.evidence);
      if (reading.kind === 'present' || reading.kind === 'spent') {
        if (reading.digest !== key.digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence: key.evidence }));
        if (reading.kind === 'spent') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: reading.at }));
        return { runId: String(reading.result) };
      }
      if (reading.kind === 'before-epoch') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: 'before-epoch' }));
    }
    const given = actDigest(answers);
    const run = yield* ledger.activeRun(threadId);
    if (!run) return yield* unavailable(threadId, questionId, given);
    const held = `${run.id}\u0000${questionId}`;
    const flying = resuming.get(held);
    if (flying !== undefined) {
      if (flying.given !== given) return yield* conflict(threadId, run.id, questionId);
      return yield* Deferred.await(flying.done);
    }
    let question: ThreadQuestionEntry | null | undefined;
    for (;;) {
      question = (yield* store.find(threadId))?.pendingInteraction;
      const started = resuming.get(held);
      if (started !== undefined) {
        if (started.given !== given) return yield* conflict(threadId, run.id, questionId);
        return yield* Deferred.await(started.done);
      }
      const pending = moving.get(held);
      if (pending === undefined) break;
      yield* Effect.forEach([...pending], (move) => Deferred.await(move), { discard: true });
    }
    if (question == null || question.questionId !== questionId) return yield* unavailable(threadId, questionId, given);
    if (!isOpenQuestion(question, run.id, questionId))
      return yield* conflict(threadId, run.id, questionId, 'This question is no longer answerable.');
    const done = Deferred.makeUnsafe<
      {
        runId: string;
      },
      ThreadBorderFailed
    >();
    resuming.set(held, { given, done });
    return yield* Effect.gen(function* () {
      const key: Keyed =
        call === undefined
          ? {
              evidence: { decidedBy: `question:${run.id}:${questionId}:answer` },
              digest: actDigest(['question-answer', run.id, questionId, answers]),
            }
          : answerKey(threadId, questionId, answers, call);
      return yield* scheduler.resume(
        run,
        Effect.fnUntraced(function* (resumption) {
          const answered = yield* recorded(threadId, run, questionId, answers, key, resumption);
          yield* note<RunNote>({ type: 'question-answered', question: questionId, outcome: 'answered' }, { run: run.id });
          if (resumption.halt.stopped) {
            yield* snapshots.publish(threadId);
            return { answer: { runId: run.id }, relaunch: null };
          }
          return { answer: { runId: run.id }, relaunch: { thread: answered.thread, questionResult: answered.questionResult } };
        }),
      );
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          resuming.delete(held);
          Deferred.doneUnsafe(
            done,
            Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? Effect.fail(conflict(threadId, run.id, questionId)) : exit,
          );
        }),
      ),
    );
  });
  const recorded = Effect.fnUntraced(function* (
    threadId: string,
    run: ThreadRunRow,
    questionId: string,
    answers: readonly ThreadInteractionAnswer[],
    key: Keyed,
    resumption: RunResumption,
  ) {
    const { interruptible } = resumption;
    const claimed = yield* store.find(threadId);
    const question = claimed?.pendingInteraction;
    if (!claimed || !isOpenQuestion(question, run.id, questionId)) return yield* conflict(threadId, run.id, questionId);
    const held = `${run.id}\u0000${questionId}`;
    answering.add(held);
    const resolutions = parking.take(run.id, questionId);
    retract(run.id);
    let executing = false;
    const guides: PendingRuntimeGuide[] = [];
    return yield* Effect.gen(function* () {
      const {
        transcript: ofRun,
        toolContext,
        door,
      } = yield* parkedDoor(
        claimed,
        run,
        resolutions,
        interruptible,
        undefined,
        (directives, at) => void guides.push(...pendingRuntimeGuides(at.hook, directives, at)),
      );
      return yield* Effect.gen(function* () {
        const { results } = yield* questionToolResults({
          executing: () => {
            executing = true;
          },
          question,
          answers,
          transcript: ofRun,
          options: { messages: [...claimed.history] },
          halt: resumption.halt,
          catalog: toolContext.catalog,
          door,
        }).pipe(Effect.ensuring(door.close()));
        if (results.length === 0) return yield* conflict(threadId, run.id, questionId);
        const answeredQuestion: ThreadQuestionEntry = {
          ...question,
          status: 'answered',
          answers,
          updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        const toolMessage = toolMessageFromResults(results);
        const told = new AgentGuidanceJournal(run.id).emit(door.runState.stepNumber, guides);
        yield* Effect.flatMap(
          transitionNow<string, ThreadWriteTx>(
            kernel,
            threadId,
            {
              declared: [],
              decide: Effect.fnUntraced(function* ({ row }, tx) {
                if (!isOpenQuestion(row.pendingInteraction, run.id, questionId)) return yield* conflict(threadId, run.id, questionId);
                return {
                  apply: true,
                  result: run.id,
                  events: [
                    ...questionToolResultEvents(yield* store.entriesOfRun(threadId, answeredQuestion.runId, tx), answeredQuestion, results),
                    threadQuestionEvent(answeredQuestion, [toolMessage]),
                    ...questionGuidanceEvents(question),
                    ...(told === null ? [] : [threadGuidanceEvent(told)]),
                  ],
                  patch: { pendingInteraction: yield* slotAfter(store, threadId, row.pendingInteraction, answeredQuestion, 'parked', tx) },
                  participants: (unit) => toolContext.toolOutputs.commitReferenced([toolMessage], [], unit),
                } as Decision<string, ThreadWriteTx>;
              }),
            },
            key,
          ),
          (outcome) => answerOf(threadId, outcome),
        );
        const current = yield* store.find(threadId);
        if (!current) return yield* new ThreadCallBroke({ cause: new ThreadNotFoundError(threadId) });
        return { thread: current, questionResult: { results } };
      }).pipe(Effect.onExit(() => disposed(toolContext)));
    }).pipe(
      Effect.ensuring(Effect.sync(() => answering.delete(held))),
      Effect.onError((cause) => {
        const stopped = !executing && resumption.halt.stopped && Cause.hasInterruptsOnly(cause);
        return clear(
          threadId,
          run.id,
          stopped
            ? 'The run stopped before its answer reached tool execution.'
            : 'The run ended before this answer was recorded; whether its calls reached anything is unknown.',
          stopped ? cancelledQuestion : unsettledQuestion,
        ).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.logWarning('a pending interaction could not be cleared', {
                  threadId,
                  runId: run.id,
                  error: threadFailureMessage(Cause.squash(exit.cause)),
                }),
          ),
        );
      }),
    );
  });
  const lapse = Effect.fnUntraced(function* (
    threadId: string,
    runId: string,
    questionId: string,
    withinMs: number,
  ): Effect.fn.Return<void, ThreadBorderFailed, QuestionIntake> {
    const run = yield* ledger.activeRun(threadId);
    if (!run || run.id !== runId) return;
    const standing: ParkedResume<void> = { answer: undefined, relaunch: null };
    yield* scheduler.resume(
      run,
      Effect.fnUntraced(function* (resumption) {
        const expired = (yield* store.find(threadId))?.pendingInteraction;
        if (!isOpenQuestion(expired, run.id, questionId)) return standing;
        const results = expired.toolCalls.map((call) => unansweredResult(call, expired, withinMs));
        const cleared: ThreadQuestionEntry = {
          ...expired,
          status: 'lapsed',
          updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        const toolMessage = toolMessageFromResults(results);
        const outcome = yield* transitionNow<undefined, ThreadWriteTx>(
          kernel,
          threadId,
          {
            declared: [],
            decide: Effect.fnUntraced(function* ({ row }, tx) {
              if (!isOpenQuestion(row.pendingInteraction, run.id, questionId)) return untouched;
              return {
                apply: true,
                result: undefined,
                events: [
                  ...questionToolResultEvents(yield* store.entriesOfRun(threadId, expired.runId, tx), cleared, results),
                  threadQuestionEvent(cleared, [toolMessage]),
                  ...questionGuidanceEvents(expired),
                ],
                patch: { pendingInteraction: yield* slotAfter(store, threadId, row.pendingInteraction, cleared, 'parked', tx) },
              } as Decision<undefined, ThreadWriteTx>;
            }),
          },
          {
            evidence: { decidedBy: `question:${run.id}:${questionId}:expire` },
            digest: actDigest(['question-expire', run.id, questionId]),
          },
        );
        if (!('committed' in outcome)) return standing;
        const current = yield* store.find(threadId);
        if (!current) return standing;
        released(run.id);
        yield* note<RunNote>({ type: 'question-answered', question: questionId, outcome: 'cleared' }, { run: run.id });
        if (resumption.halt.stopped) {
          yield* snapshots.publish(threadId);
          return standing;
        }
        return { answer: undefined, relaunch: { thread: current, questionResult: { results } } };
      }),
    );
  });
  const stop = Effect.fnUntraced(function* (
    threadId: string,
    runId: string,
    questionId: string,
    called: AgentToolStop,
  ): Effect.fn.Return<void, ThreadBorderFailed, QuestionIntake> {
    const { toolCallId, reason, refusal } = called;
    const run = yield* ledger.activeRun(threadId);
    if (!run || run.id !== runId) return;
    let settled: ThreadStreamQuestionResult | undefined;
    let complete = false;
    const stopped = yield* transitionNow<undefined, ThreadWriteTx>(
      kernel,
      threadId,
      {
        declared: [],
        decide: Effect.fnUntraced(function* ({ row }, tx) {
          const question = row.pendingInteraction;
          if (!question || question.runId !== runId || question.questionId !== questionId || question.status !== 'open') return untouched;
          const selected = question.toolCalls.filter((call) => call.toolCallId === toolCallId);
          if (selected.length === 0) return untouched;
          const selectedQuestion = { ...question, toolCalls: selected };
          const cancelled =
            refusal === undefined ? cancelledQuestion(selectedQuestion, reason) : refusedQuestion(selectedQuestion, refusal);
          const remaining = question.toolCalls.filter((call) => call.toolCallId !== toolCallId);
          complete = remaining.length === 0;
          const next: ThreadQuestionEntry = complete
            ? cancelled.question
            : {
                ...question,
                toolCalls: remaining,
                questions: question.questions.filter((prompt) => prompt.toolCallId !== toolCallId),
                updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              };
          settled = { results: cancelled.results };
          return {
            apply: true,
            result: undefined,
            events: [
              ...questionToolResultEvents(yield* store.entriesOfRun(threadId, runId, tx), question, cancelled.results),
              threadQuestionEvent(next, [cancelled.message]),
              ...(complete ? questionGuidanceEvents(question) : []),
            ],
            patch: { pendingInteraction: yield* slotAfter(store, threadId, question, next, 'parked', tx) },
          } as Decision<undefined, ThreadWriteTx>;
        }),
      },
      {
        evidence: { decidedBy: `question:${runId}:${questionId}:stop:${toolCallId}` },
        digest: actDigest(['question-stop', runId, questionId, toolCallId, reason]),
      },
    ).pipe(Effect.catchTag('ThreadNotFound', () => Effect.succeed(null)));
    if (stopped === null || !('committed' in stopped) || settled === undefined) return;
    const current = yield* store.find(threadId);
    if (!current) return;
    yield* snapshots.publish(threadId);
    if (!complete) return;
    const questionResult = settled;
    yield* scheduler.resume(run, (resumption) =>
      Effect.sync(() => {
        released(runId);
        return { answer: undefined, relaunch: resumption.halt.stopped ? null : { thread: current, questionResult } };
      }),
    );
  });
  const park = Effect.fnUntraced(function* (
    run: ThreadRunRef,
    asked: ThreadQuestionEntry | null,
    door: AgentToolDoor | null,
    untold: readonly PendingRuntimeGuide[] = [],
  ): Effect.fn.Return<RunParked | null, ThreadBorderFailed> {
    const told = new AgentGuidanceJournal(run.id).emit(door?.runState.stepNumber ?? 0, untold);
    const routed =
      asked === null
        ? null
        : yield* routedTo(approvers, run.threadId, {
            ...asked,
            timeoutMs:
              door === null
                ? (asked.timeoutMs ?? null)
                : withinOf(asked, door.resolutionsOf(asked.toolCalls.map((call) => call.toolCallId))),
          });
    const question = routed === null || told === null ? routed : { ...routed, guidance: told };
    if (question !== null && door !== null) hold(run, question, door);
    yield* written(run.threadId, run.id, question, told);
    if (question !== null) yield* announcedTo(approvers, run.threadId, question);
    if (asked === null) return null;
    const parked = yield* lifecycle.park(run);
    if (parked === 'parked') waived(run, asked);
    return parked;
  });
  const intake = QuestionIntake.of({ park, ask });
  return {
    intake,
    clear,
    answer: (threadId: string, questionId: string, answers: readonly ThreadInteractionAnswer[], call?: CallerKey) =>
      answer(threadId, questionId, answers, call).pipe(Effect.provideService(QuestionIntake, intake)),
  };
});
