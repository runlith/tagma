import { Result, Schema, SchemaGetter } from 'effect';
import { toolArgumentsResult, type ToolArgumentsInvalid } from '../agent/ToolArguments';
import { Tool } from '../agent/tool';
import type { ToolCatalog } from '../agent/ToolCatalog';
import type { ThreadQuestionEntry } from '../transcript/entries';
import { questionEntryId } from '../transcript/entryNames';
import { USER_QUESTION_TOOL_NAME as ASK_USER_TOOL } from '../transcript/parts';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

const UNICODE_ESCAPE = /\\u[0-9a-fA-F]{4}/g;

const text = (min: number, max: number) =>
  Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(Schema.isBetweenLength(min, max)), {
      decode: SchemaGetter.transform(unescapeUnicode),
      encode: SchemaGetter.passthrough(),
    }),
  );

const QuestionOption = Schema.Struct({
  value: text(1, 200),
  label: text(1, 200),
  description: Schema.optional(text(1, 500)),
  preview: Schema.optional(text(1, 500)),
});

const QuestionPromptInput = Schema.Struct({
  prompt: text(1, 1000),
  header: Schema.optional(text(1, 160)),
  options: Schema.optional(Schema.Array(QuestionOption).check(Schema.isBetweenLength(1, 12))),
  allowMultiple: Schema.optional(Schema.Boolean),
  allowFreeform: Schema.optional(Schema.Boolean),
  secret: Schema.optional(Schema.Boolean),
});

const UserQuestionInput = Schema.Struct({
  title: Schema.optional(text(1, 160)),
  questions: Schema.Array(QuestionPromptInput).check(Schema.isBetweenLength(1, 8)),
});

type QuestionPrompt = ThreadQuestionEntry['questions'][number];
type QuestionAnswer = NonNullable<ThreadQuestionEntry['answers']>[number];
type QuestionPromptInput = typeof QuestionPromptInput.Type;

export type UserQuestionToolCall = {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type UserQuestionAnswerResult = Record<string, unknown>;

export const threadUserQuestionTool = Tool.make({
  approval: ASKS_NEVER,
  exposure: 'deferred',
  description:
    'Ask the user a BLOCKING interactive question: a multi-select, a bundle of related questions, or a secret value that must be answered before you continue. A simple single-choice question is reply text (with ready answers, when that tool is offered) — never this. After you call it, stop for the turn; the answer arrives as answers[].values with optional answers[].notes.',
  parameters: UserQuestionInput,
  display: () => ({ form: 'none' }),
});

export const USER_QUESTION_SOURCE = 'user-question';

export const threadUserQuestionTools: ToolCatalog = {
  [ASK_USER_TOOL]: threadUserQuestionTool,
};

export function isUserQuestionToolName(toolName: string): boolean {
  return toolName === ASK_USER_TOOL;
}

export function userQuestionFromToolCall(
  call: UserQuestionToolCall,
  askedAt: string,
  catalog?: () => ReadonlyMap<string, Tool>,
): Result.Result<ThreadQuestionEntry | null, ToolArgumentsInvalid> {
  if (!isUserQuestionToolName(call.toolName)) return Result.succeed(null);
  const parsed = toolArgumentsResult(threadUserQuestionTool, call.toolName, call.input, catalog);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  const asked = parsed.success;
  return Result.succeed({
    type: 'question',
    id: questionEntryId(call.runId, [call.toolCallId]),
    runId: call.runId,
    questionId: call.toolCallId,
    questions: asked.questions.map((question, index) => ({
      id: asked.questions.length === 1 ? call.toolCallId : `${call.toolCallId}:${index + 1}`,
      toolCallId: call.toolCallId,
      ...questionPrompt(question, asked.title),
    })),
    toolCalls: [{ toolCallId: call.toolCallId, toolName: call.toolName }],
    status: 'open',
    occurredAt: askedAt,
  });
}

export function userAnswerFromQuestion(
  question: ThreadQuestionEntry,
  toolCallId: string,
  answers: readonly QuestionAnswer[],
): UserQuestionAnswerResult | null {
  if (!question.toolCalls.some((call) => call.toolCallId === toolCallId && call.toolName === ASK_USER_TOOL)) return null;
  const promptIds = new Set(question.questions.filter((prompt) => prompt.toolCallId === toolCallId).map((prompt) => prompt.id));
  return {
    status: 'answered',
    answers: answers
      .filter((answer) => promptIds.has(answer.questionId))
      .map((answer) => ({
        questionId: answer.questionId,
        values: answer.values,
        notes: answer.annotation?.notes ? answer.annotation.notes : undefined,
        preview: answer.annotation?.preview ? answer.annotation.preview : undefined,
      })),
  };
}

function questionPrompt(input: QuestionPromptInput, title: string | undefined): Omit<QuestionPrompt, 'id' | 'toolCallId'> {
  return {
    prompt: input.prompt,
    ...(input.header ? { header: input.header } : title ? { header: title } : {}),
    options: input.options,
    allowMultiple: input.allowMultiple ? true : undefined,
    allowFreeform: input.allowFreeform ? true : undefined,
    secret: input.secret ? true : undefined,
  };
}

function unescapeUnicode(value: string): string {
  return value.replace(UNICODE_ESCAPE, (sequence) => String.fromCharCode(Number.parseInt(sequence.slice(2), 16)));
}
