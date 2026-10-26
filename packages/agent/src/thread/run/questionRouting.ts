import { Effect } from 'effect';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { askedActionsOf, type ApprovalPrompt, type ApproversPort } from '../Approvers';
import { isToolConfirmationQuestion } from './ToolQuestion';

export const routedTo = Effect.fnUntraced(function* (
  approvers: ApproversPort,
  threadId: string,
  entry: ThreadQuestionEntry,
): Effect.fn.Return<ThreadQuestionEntry, ThreadBorderFailed> {
  const asked = askedActionsOf(entry);
  if (asked.length === 0) return entry;
  const route = yield* approvers.route(threadId, asked);
  const { approver: _kept, ...rest } = entry;
  return route.approver === null ? rest : { ...rest, approver: route.approver };
});

const promptsOf = (entry: ThreadQuestionEntry): readonly ApprovalPrompt[] | null =>
  isToolConfirmationQuestion(entry)
    ? null
    : entry.questions.map((prompt) => ({
        id: prompt.id,
        prompt: prompt.prompt,
        header: prompt.header,
        options: prompt.options ?? [],
        freeform: prompt.allowFreeform === true || (prompt.options ?? []).length === 0,
        multiple: prompt.allowMultiple === true,
      }));

export const announcedTo = (
  approvers: ApproversPort,
  threadId: string,
  entry: ThreadQuestionEntry,
): Effect.Effect<void, ThreadBorderFailed> =>
  entry.approver === undefined
    ? Effect.void
    : approvers.notify(entry.approver, {
        id: `approval:${threadId}:${entry.runId}:${entry.questionId}:${entry.approver}`,
        threadId,
        questionId: entry.questionId,
        summary: [entry.questions[0]?.header, entry.questions[0]?.prompt ?? entry.toolCalls[0]?.toolName ?? 'a question']
          .filter((part) => part !== undefined)
          .join(': '),
        timeoutMs: entry.timeoutMs ?? null,
        deadlineAt:
          entry.timeoutMs == null || entry.occurredAt === undefined
            ? null
            : new Date(Date.parse(entry.occurredAt) + entry.timeoutMs).toISOString(),
        prompts: promptsOf(entry),
      });
