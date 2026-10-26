import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadRunProgress } from '../rows';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '../storage/runs';

export const ROUTED_AWAITING: ThreadRunProgress = { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: 'The agent waits for an answer.' };

export const ROUTED_RESUMED: ThreadRunProgress = { stage: 'running', message: 'The agent works.' };

export type RoutedQuestion = ThreadQuestionEntry & { readonly route: string };

export const routedEntry = (entry: ThreadQuestionEntry): entry is RoutedQuestion => entry.route !== undefined;

export function endedWhileOpen(status: string, failureReason: string | null): string {
  if (status === 'completed') return 'The agent finished its turn while this question was open.';
  if (status === 'failed') return `The run failed while this question was open${failureReason === null ? '.' : `: ${failureReason}`}`;
  return 'The run was stopped while this question was open.';
}

export function withoutAnswers(entry: ThreadQuestionEntry): ThreadQuestionEntry {
  const { answers: _recorded, deliveryUnknown: _unknown, deliveryNote: _note, ...rest } = entry;
  return rest;
}

export function unofferedAnswer(entry: ThreadQuestionEntry, answers: readonly ThreadInteractionAnswer[]): string | null {
  if (answers.length !== entry.questions.length) return 'Answer every question this entry asks, once.';
  const seen = new Set<string>();
  for (const answer of answers) {
    const prompt = entry.questions.find((each) => each.id === answer.questionId);
    if (prompt === undefined || seen.has(prompt.id))
      return `Answer the questions this entry asks by their ids: ${entry.questions.map((each) => each.id).join(', ')}.`;
    seen.add(prompt.id);
    if (answer.values.length === 0 || (prompt.allowMultiple !== true && answer.values.length > 1)) {
      return 'Choose exactly one offered value.';
    }
    const offered = prompt.options?.map((option) => option.value) ?? [];
    const stray =
      prompt.allowFreeform === true || offered.length === 0 ? undefined : answer.values.find((value) => !offered.includes(value));
    if (stray !== undefined) return `This question does not offer ${stray}. It offers: ${offered.join(', ')}.`;
  }
  return null;
}
