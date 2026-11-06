import { Context, Effect } from 'effect';
import type { ThreadInteractionPrompt, ThreadQuestionEntry } from '../transcript/entries';
import { THREAD_TOOL_CONFIRM_KIND, USER_QUESTION_TOOL_NAME } from '../transcript/parts';
import type { ThreadBorderFailed } from './ThreadBorder';

export type ApprovalPrompt = {
  readonly id: string;
  readonly prompt: string;
  readonly header?: string;
  readonly options: NonNullable<ThreadInteractionPrompt['options']>;
  readonly freeform: boolean;
  readonly multiple: boolean;
};

export type AskedAction = { readonly action: string; readonly asked: readonly string[]; readonly parent?: true };

export type ApproverWhy = 'owner' | 'taken-over' | 'parent' | 'parent-owns' | 'no-grant' | 'no-parent';

export type ApproverRoute = { readonly approver: string | null; readonly why: ApproverWhy };

export type ApprovalNotice = {
  readonly id: string;
  readonly threadId: string;
  readonly questionId: string;
  readonly summary: string;
  readonly timeoutMs: number | null;
  readonly deadlineAt: string | null;
  readonly prompts: readonly ApprovalPrompt[] | null;
};

export type ApproversPort = {
  route(threadId: string, asked: readonly AskedAction[], questionId: string): Effect.Effect<ApproverRoute, ThreadBorderFailed>;
  notify(approver: string, notice: ApprovalNotice): Effect.Effect<void, ThreadBorderFailed>;
  grantOf(threadId: string): Effect.Effect<readonly string[], ThreadBorderFailed>;
};

export const OPERATOR_ONLY: ApproversPort = {
  route: () => Effect.succeed({ approver: null, why: 'no-parent' }),
  notify: () => Effect.void,
  grantOf: () => Effect.succeed([]),
};

export const Approvers = Context.Reference<ApproversPort>('@runlith/agent/Approvers', { defaultValue: () => OPERATOR_ONLY });

export const APPROVES_ALL = '*';

export type AskedBy = { readonly action?: string; readonly asked?: readonly string[]; readonly parent?: boolean };

export const askedActionsOf = (entry: ThreadQuestionEntry): readonly AskedAction[] => {
  if (entry.questions.some((prompt) => prompt.secret === true)) return [];
  return entry.questions.flatMap((prompt) => {
    const data = prompt.data as AskedBy | undefined;
    const call = entry.toolCalls.find((each) => each.toolCallId === prompt.toolCallId);
    const confirm = prompt.kind === THREAD_TOOL_CONFIRM_KIND;
    if (!confirm && call?.toolName === USER_QUESTION_TOOL_NAME) return [{ action: USER_QUESTION_TOOL_NAME, asked: [] }];
    const action = confirm ? (entry.action?.operation ?? call?.toolName) : data?.action;
    if (action === undefined) return [];
    const one = { action, asked: data?.asked ?? [] };
    return [!confirm && data?.parent === true ? { ...one, parent: true as const } : one];
  });
};

export const grantCovers = (grant: ReadonlySet<string>, asked: readonly AskedAction[]): boolean =>
  asked.length > 0 &&
  asked.every(
    (one) => grant.has(APPROVES_ALL) || grant.has(one.action) || (one.asked.length > 0 && one.asked.every((id) => grant.has(id))),
  );
