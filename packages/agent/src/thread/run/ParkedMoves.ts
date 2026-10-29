import { Cause, Clock, Effect } from 'effect';
import type { AgentToolFailure } from '../../agent/AgentFailure';
import type { CallControlResult } from '../../agent/callProgress';
import { doorToolOutcome, type AgentToolInvocation, type AgentToolResolution } from '../../agent/door/types';
import { ModeLaw } from '../../modes/ModeLaw';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { threadQuestionEvent } from '../events';
import { actDigest } from '../keyed';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadFeed, ThreadOwedCalls, type ThreadWriteTx } from '../ThreadPorts';
import { transitionDeps, transitionNow } from '../transition/kernel';
import type { Decision } from '../transition/port';
import { callConfirmation } from './callConfirmation';
import { settledLate } from './lateSettlement';
import { disposed, type ParkedDoors } from './parkedDoor';
import { isOpenQuestion, slotAfter } from './pendingSlot';
import { RunScheduler } from './scheduler/RunScheduler';
import type { AskQuestion, QuestionIntake } from './scheduler/intake';
import { questionGuidanceEvents, questionToolResultEvents, toolInputFromTranscript, toolMessageFromResults } from './ThreadQuestion';
import type { ToolQuestionResult } from './ToolQuestion';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
import { ThreadSnapshots } from './ThreadSnapshots';

const BEING_ANSWERED = 'The question this call waits on is being answered, so the answer decides it.';
const UNASKED = 'The question this call waited on no longer asks about it.';
const untouched = { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
const unavailable = (detail: string): CallControlResult => ({ status: 'unavailable', detail });

export type ParkedMove = (
  run: ThreadRunRef,
  questionId: string,
  toolCallId: string,
  resolutions: readonly AgentToolResolution[],
) => Effect.Effect<CallControlResult, never, QuestionIntake>;

export const makeParkedMoves = Effect.fnUntraced(function* (input: {
  readonly claim: (runId: string, questionId: string) => (() => void) | null;
  readonly released: (runId: string) => void;
  readonly maintain: (work: Effect.Effect<void, ThreadBorderFailed, QuestionIntake>) => void;
  readonly ask: AskQuestion;
  readonly parkedDoor: ParkedDoors;
}) {
  const kernel = yield* transitionDeps;
  const ledger = yield* ThreadRunLedger;
  const scheduler = yield* RunScheduler;
  const snapshots = yield* ThreadSnapshots;
  const owedCalls = yield* ThreadOwedCalls;
  const laws = yield* ModeLaw;
  const feed = yield* ThreadFeed;
  const { store } = kernel;
  const moving = Effect.fnUntraced(function* (
    owing: NonNullable<typeof owedCalls>,
    asked: ThreadRunRef,
    questionId: string,
    toolCallId: string,
    resolutions: readonly AgentToolResolution[],
    moved: { committed: boolean },
  ): Effect.fn.Return<CallControlResult, ThreadBorderFailed | AgentToolFailure, QuestionIntake> {
    const held = input.claim(asked.id, questionId);
    if (held === null) return unavailable(BEING_ANSWERED);
    return yield* transfer(owing, asked, questionId, toolCallId, resolutions, moved).pipe(Effect.ensuring(Effect.sync(held)));
  });
  const transfer = Effect.fnUntraced(function* (
    owing: NonNullable<typeof owedCalls>,
    asked: ThreadRunRef,
    questionId: string,
    toolCallId: string,
    resolutions: readonly AgentToolResolution[],
    moved: { committed: boolean },
  ): Effect.fn.Return<CallControlResult, ThreadBorderFailed | AgentToolFailure, QuestionIntake> {
    const threadId = asked.threadId;
    const run = yield* ledger.activeRun(threadId);
    const claimed = yield* store.find(threadId);
    const question = claimed?.pendingInteraction;
    if (!run || run.id !== asked.id || !claimed || !isOpenQuestion(question, run.id, questionId)) return unavailable(UNASKED);
    const asking = question.toolCalls.find((call) => call.toolCallId === toolCallId);
    if (asking === undefined) return unavailable(UNASKED);
    const { transcript, toolContext, door } = yield* input.parkedDoor(
      claimed,
      run,
      resolutions,
      (work) => work,
      (context) => ({
        retain: () => Effect.succeed({ release: Effect.void }),
        asking: callConfirmation(input.ask, laws.of(threadId, claimed.authority.mode)),
        completed: (call, exit) =>
          settledLate(kernel, feed, context.toolOutputs, threadId, run.id, call, exit).pipe(
            Effect.andThen(snapshots.publish(threadId)),
            Effect.catchCause((cause) =>
              Effect.logWarning('the late result of a call moved to the background stays out of its entry', Cause.pretty(cause)),
            ),
          ),
      }),
    );
    let lent = false;
    let abandon: Effect.Effect<void> = Effect.void;
    return yield* Effect.gen(function* () {
      const tool = toolContext.catalog[asking.toolName];
      if (tool === undefined) return unavailable(UNASKED);
      const toolInput = toolInputFromTranscript(transcript, toolCallId);
      const invocation: AgentToolInvocation = {
        name: asking.toolName,
        tool,
        input: toolInput,
        options: { toolCallId, messages: [...claimed.history] },
      };
      const adoption = yield* door.adopt(invocation, yield* door.approved({ name: asking.toolName, tool, input: toolInput, toolCallId }));
      if ('refused' in adoption) return unavailable(adoption.refused);
      abandon = adoption.abandon;
      const receipt = adoption.receipt;
      const result: ToolQuestionResult = {
        toolCallId,
        toolName: asking.toolName,
        outcome: doorToolOutcome(receipt),
        modelOutput: receipt.modelOutput,
        display: receipt.display,
        retained: receipt.retained,
        durationMs: receipt.durationMs,
      };
      let complete = false;
      const narrowed = yield* transitionNow<undefined, ThreadWriteTx>(
        kernel,
        threadId,
        {
          declared: [],
          decide: Effect.fnUntraced(function* ({ row }, tx) {
            const standing = row.pendingInteraction;
            if (!isOpenQuestion(standing, run.id, questionId) || !standing.toolCalls.some((call) => call.toolCallId === toolCallId)) {
              return untouched;
            }
            const remaining = standing.toolCalls.filter((call) => call.toolCallId !== toolCallId);
            complete = remaining.length === 0;
            const updatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
            const next: ThreadQuestionEntry = complete
              ? { ...standing, status: 'cleared', updatedAt }
              : {
                  ...standing,
                  toolCalls: remaining,
                  questions: standing.questions.filter((prompt) => prompt.toolCallId !== toolCallId),
                  updatedAt,
                };
            return {
              apply: true,
              result: undefined,
              events: [
                ...questionToolResultEvents(yield* store.entriesOfRun(threadId, run.id, tx), standing, [result]),
                threadQuestionEvent(next, [toolMessageFromResults([result])]),
                ...(complete ? questionGuidanceEvents(standing) : []),
              ],
              patch: { pendingInteraction: yield* slotAfter(store, threadId, standing, next, 'parked', tx) },
              participants: (unit) => owing.owe(adoption.call, unit),
            } as Decision<undefined, ThreadWriteTx>;
          }),
        },
        {
          evidence: { decidedBy: `question:${run.id}:${questionId}:background:${toolCallId}` },
          digest: actDigest(['question-background', run.id, questionId, toolCallId]),
        },
      ).pipe(Effect.catchTag('ThreadNotFound', () => Effect.succeed(null)));
      if (narrowed === null || !('committed' in narrowed)) return unavailable(UNASKED);
      moved.committed = true;
      lent = true;
      yield* adoption.live;
      input.maintain(Effect.andThen(adoption.settled, disposed(toolContext)));
      input.maintain(
        Effect.gen(function* () {
          yield* snapshots.publish(threadId);
          if (!complete) return;
          const current = yield* store.find(threadId);
          if (current === undefined) return;
          yield* scheduler.resume(run, (resumption) =>
            Effect.sync(() => {
              input.released(run.id);
              return {
                answer: undefined,
                relaunch: resumption.halt.stopped ? null : { thread: current, questionResult: { results: [result] } },
              };
            }),
          );
        }),
      );
      return { status: 'changed', detail: null } satisfies CallControlResult;
    }).pipe(
      Effect.ensuring(door.close()),
      Effect.ensuring(Effect.suspend(() => (lent ? Effect.void : Effect.andThen(abandon, disposed(toolContext))))),
    );
  });
  const owing = owedCalls;
  if (owing === null) return null;
  const move: ParkedMove = (run, questionId, toolCallId, resolutions) =>
    Effect.suspend(() => {
      const moved = { committed: false };
      return moving(owing, run, questionId, toolCallId, resolutions, moved).pipe(
        Effect.catchCause((cause) => {
          const said = Cause.pretty(cause).split('\n', 1)[0];
          return Effect.succeed(
            unavailable(
              moved.committed
                ? `The call left its question for the background, but its life there did not start: ${said}. Its outcome stays owed to the thread.`
                : `The call stays parked on its question: ${said}`,
            ),
          );
        }),
      );
    });
  return move;
});
