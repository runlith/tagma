import { Effect, Result, Schema } from 'effect';
import { toolArgumentsResult, type ToolArgumentsInvalid } from '../agent/ToolArguments';
import { Tool } from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import type { ThreadReadyAnswersEntry } from '../transcript/entries';
import { readyAnswersEntryId } from '../transcript/entryNames';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

export const READY_ANSWERS_TOOL = 'offer_ready_answers';

const ReadyAnswer = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1)),
  send: Schema.String.check(Schema.isMinLength(1)),
});

const ReadyAnswersInput = Schema.Struct({
  answers: Schema.Array(ReadyAnswer).check(Schema.isBetweenLength(2, 4)),
});

export type ReadyAnswersToolCall = {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  occurredAt?: string;
};

const readyAnswersTool = Tool.make({
  approval: ASKS_NEVER,
  userVisible: true,
  description:
    'Offer ready answers to your reply, when its natural answers are a few short choices. Call this first, then write the reply the answers respond to. Provide 2–4 mutually distinct complete answers; choosing one sends its text verbatim as the user’s message, so an answer is never a template with a blank to finish. The user can always type freely instead. At most one call per reply.',
  parameters: ReadyAnswersInput,
  display: () => ({ form: 'none' }),
  execute: () => Effect.succeed({ status: 'offered' as const }),
});

export const threadReadyAnswerTools: ToolCatalog = {
  [READY_ANSWERS_TOOL]: readyAnswersTool,
};

export function isReadyAnswersToolName(toolName: string): boolean {
  return toolName === READY_ANSWERS_TOOL;
}

export function readyAnswersFromToolCall(call: ReadyAnswersToolCall): Result.Result<ThreadReadyAnswersEntry | null, ToolArgumentsInvalid> {
  if (!isReadyAnswersToolName(call.toolName)) return Result.succeed(null);
  const parsed = toolArgumentsResult(readyAnswersTool, call.toolName, call.input);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  return Result.succeed({
    type: 'ready-answers',
    id: readyAnswersEntryId(call.runId, call.toolCallId),
    runId: call.runId,
    answers: parsed.success.answers,
    occurredAt: call.occurredAt ?? new Date().toISOString(),
  });
}
