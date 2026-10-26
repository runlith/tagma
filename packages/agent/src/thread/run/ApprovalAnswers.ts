import { Context, Effect, Layer } from 'effect';
import { THREAD_TOOL_CANCEL_VALUE, THREAD_TOOL_CONFIRM_VALUE } from '../../transcript/parts';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { Questions } from './Questions';
import { unofferedAnswer } from './routedQuestions';
import { isToolConfirmationQuestion, toolCallsFromQuestion } from './ToolQuestion';

export type ApprovalChoice =
  | { readonly allow: boolean; readonly note?: string }
  | { readonly values: readonly string[] }
  | { readonly answers: readonly { readonly questionId: string; readonly values: readonly string[] }[] };

export type ApprovalAnswered = 'answered' | 'not-the-approver' | 'unknown' | 'unoffered' | 'unwritten';

export type ApprovalAnswering = {
  answer(input: {
    readonly caller: string;
    readonly threadId: string;
    readonly questionId: string;
    readonly choice: ApprovalChoice;
  }): Effect.Effect<ApprovalAnswered, ThreadBorderFailed>;
};

const answersOf = (entry: ThreadQuestionEntry, choice: ApprovalChoice): readonly ThreadInteractionAnswer[] | null => {
  const approval = isToolConfirmationQuestion(entry);
  if ('allow' in choice) {
    if (!approval) return null;
    return toolCallsFromQuestion(entry).map((call) => ({
      questionId: call.toolCallId,
      values: [choice.allow ? THREAD_TOOL_CONFIRM_VALUE : THREAD_TOOL_CANCEL_VALUE],
    }));
  }
  if (approval) return null;
  const answers =
    'answers' in choice
      ? choice.answers.map((answer) => ({ questionId: answer.questionId, values: [...answer.values] }))
      : entry.questions.map((prompt) => ({ questionId: prompt.id, values: [...choice.values] }));
  return unofferedAnswer(entry, answers) === null ? answers : null;
};

export const ApprovalAnswers = Context.Reference<ApprovalAnswering | null>('@runlith/agent/ApprovalAnswers', { defaultValue: () => null });

export const approvalAnswersLayer: Layer.Layer<never, never, Questions> = Layer.effect(
  ApprovalAnswers,
  Effect.gen(function* () {
    const questions = yield* Questions;
    return {
      answer: Effect.fnUntraced(function* ({ caller, threadId, questionId, choice }) {
        const entry = (yield* questions.open(threadId)).find((each) => each.questionId === questionId);
        if (entry === undefined) return 'unknown' as const;
        if (entry.approver !== caller) return 'not-the-approver' as const;
        const answers = answersOf(entry, choice);
        if (answers === null) return 'unoffered' as const;
        const decided = yield* questions.decide({ threadId, questionId, caller, note: 'note' in choice ? choice.note : undefined });
        if (decided !== 'decided') return decided;
        const answered = yield* questions.answer(threadId, questionId, answers);
        if (answered === null) return 'unknown' as const;
        const after = (yield* questions.open(threadId)).find((each) => each.questionId === questionId);
        return after !== undefined && after.answers === undefined && after.deliveryUnknown !== true
          ? ('unwritten' as const)
          : ('answered' as const);
      }),
    } satisfies ApprovalAnswering;
  }),
) as unknown as Layer.Layer<never, never, Questions>;
