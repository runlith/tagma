import { Context, Effect } from 'effect';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { ThreadAnswerInvalidError } from '@runlith/agent/thread/run/ThreadQuestion';
import type { ThreadInteractionAnswer } from '@runlith/agent/transcript/entries';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { gated } from '../projectGate.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { ReaderMarking } from './reader.js';

type Answered = Effect.Effect<{ runId: string }, HarnessFailure>;

export class ThreadAsks extends Context.Service<
  ThreadAsks,
  {
    answer(
      threadId: string,
      projectId: number,
      input: { questionId: string; answers: readonly ThreadInteractionAnswer[]; key?: string | undefined },
    ): Answered;
  }
>()('tagma/threads/ThreadAsks') {}

export const makeThreadAsks = Effect.gen(function* () {
  const records = yield* ThreadRecords;
  const reader = yield* ReaderMarking;
  const questions = (yield* ThreadHarness).runs.questions();
  return ThreadAsks.of({
    answer: (threadId, projectId, input) =>
      gated(records, threadId, projectId, () =>
        Effect.tap(
          Effect.gen(function* () {
            const call = input.key === undefined ? undefined : { actor: OPERATOR_PRINCIPAL, key: input.key };
            const answered = yield* questions.answer(threadId, input.questionId, input.answers, call).pipe(
              Effect.mapError((failure) => {
                const cause = threadCauseOf(failure);
                if (cause instanceof ThreadAnswerInvalidError) {
                  return new GateRefusal('answer-invalid', cause.message, ['answer with a value this question offers']);
                }
                return cause instanceof GateRefusal ? cause : failure;
              }),
            );
            if (answered !== null) return answered;
            return yield* new GateRefusal('interaction-conflict', 'This question is no longer answerable.', [
              'read the thread to see what it asks',
            ]);
          }),
          () => reader.wrote(threadId),
        ),
      ),
  });
});
