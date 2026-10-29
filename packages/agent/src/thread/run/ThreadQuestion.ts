import { Data, Clock, Effect, Result } from 'effect';
import type { ToolArgumentsInvalid } from '../../agent/ToolArguments';
import type { RunStop } from '../../agent/RunStop';
import { sha256 } from '@runlith/utils/sha256';
import { toJson } from '@runlith/utils/json';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { settleTool, type ThreadInteractionAnswer, type ThreadQuestionEntry, type ThreadToolEntry } from '../../transcript/entries';
import { interactionQuestionEntryId, toolEntryId } from '../../transcript/entryNames';
import type { ThreadRunRow } from '../rows';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { entryOf } from '../../transcript/kinds';
import { threadEntryEvent, threadGuidanceEvent, type ThreadEventBody } from '../events';
import type { AgentStep } from '../../agent/AgentStep';
import type { AgentToolDoor } from '../../agent/door/AgentToolDoor';
import type { ToolCallArrival, ToolOutcome, ToolRefusal } from '../../agent/tool';
import type { AgentToolModelOutput } from '../../agent/ToolOutput';
import type { AgentToolRecord } from '../../agent/AgentRunState';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import { agentToolModelOutput } from '../../agent/ToolOutput';
import {
  type AskedToolCall,
  type ToolQuestionResult,
  readApprovedCalls,
  toolCallsFromQuestion,
  toolQuestionFromCall,
  toolQuestionFromCalls,
  toolResultsFromQuestion,
} from './ToolQuestion';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { USER_QUESTION_TOOL_NAME } from '../../transcript/parts';
import {
  threadUserQuestionTool,
  type UserQuestionToolCall,
  isUserQuestionToolName,
  userAnswerFromQuestion,
  userQuestionFromToolCall,
} from '../../tools/UserQuestion';

export type ThreadQuestionToolCall = UserQuestionToolCall | AskedToolCall;

export class ThreadQuestionNotFound extends Data.TaggedError('ThreadQuestionNotFound')<{
  readonly threadId: string;
  readonly questionId: string;
}> {
  override get message(): string {
    return `Thread ${this.threadId} has no question ${this.questionId} to answer.`;
  }
}

export class ThreadInteractionConflictError extends Data.TaggedError('ThreadInteractionConflict')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string;
  readonly questionId: string;
}> {
  constructor(input: { threadId: string; runId: string; questionId: string; reason?: string }) {
    super({
      message: input.reason ?? `Thread interaction ${input.questionId} is already being answered.`,
      threadId: input.threadId,
      runId: input.runId,
      questionId: input.questionId,
    });
    this.name = 'ThreadInteractionConflictError';
  }
}

export class ThreadAnswerInvalidError extends Data.TaggedError('ThreadAnswerInvalid')<{
  readonly message: string;
  readonly threadId: string;
  readonly questionId: string;
}> {
  constructor(input: { threadId: string; questionId: string; reason: string }) {
    super({ message: input.reason, threadId: input.threadId, questionId: input.questionId });
    this.name = 'ThreadAnswerInvalidError';
  }
}

export function questionFromToolCall(
  run: ThreadRunRow,
  door: AgentToolDoor,
  catalog: ToolCatalog,
  call: ThreadQuestionToolCall,
  askedAt: string,
): Result.Result<ThreadQuestionEntry | null, ToolArgumentsInvalid> {
  if (!run.interactive) return Result.succeed(null);
  if (isUserQuestionToolName(call.toolName)) return userQuestionFromToolCall(call, askedAt, () => new Map(Object.entries(catalog)));
  return Result.succeed(toolQuestionFromCall(door, catalog, call, askedAt));
}

export function questionFromToolCalls(
  run: ThreadRunRow,
  door: AgentToolDoor,
  catalog: ToolCatalog,
  calls: readonly ThreadQuestionToolCall[],
): Effect.Effect<ThreadQuestionEntry | null, ThreadCallBroke> {
  if (!run.interactive) return Effect.succeed(null);
  return Effect.gen(function* () {
    const askedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const questions = (yield* Effect.all(
      calls.map((call) =>
        isUserQuestionToolName(call.toolName)
          ? Effect.suspend(() => {
              const parsed = userQuestionFromToolCall(call, askedAt, () => new Map(Object.entries(catalog)));
              return Result.isFailure(parsed)
                ? Effect.fail(new ThreadCallBroke({ cause: parsed.failure }))
                : Effect.succeed(parsed.success);
            })
          : toolQuestionFromCalls(door, catalog, [call], askedAt),
      ),
    )).filter((question): question is ThreadQuestionEntry => question !== null);
    if (questions.length === 0) return null;
    if (questions.length !== calls.length) {
      const interactiveIds = new Set(questions.flatMap((question) => question.toolCalls.map((call) => call.toolCallId)));
      const unresolved = calls.filter((call) => !interactiveIds.has(call.toolCallId)).map((call) => call.toolName);
      return yield* new ThreadCallBroke({
        cause: new Error(`Assistant produced unresolved non-interactive tool calls: ${unresolved.join(', ')}.`),
      });
    }
    if (questions.length === 1) return questions[0] ?? null;
    const runId = questions[0]?.runId;
    if (!runId || questions.some((question) => question.runId !== runId)) {
      return yield* Effect.die(new Error('Cannot combine interactive calls from different runs.'));
    }
    const toolCalls = questions.flatMap((question) => question.toolCalls);
    const questionId = aggregateQuestionId(
      runId,
      toolCalls.map((call) => call.toolCallId),
    );
    return {
      type: 'question',
      id: interactionQuestionEntryId(questionId),
      runId,
      questionId,
      questions: questions.flatMap((question) => question.questions),
      toolCalls,
      status: 'open',
      occurredAt: askedAt,
    };
  });
}

export const pendingQuestionFromSteps = Effect.fnUntraced(function* (
  run: ThreadRunRow,
  steps: readonly AgentStep[],
  questionForTools: (calls: readonly ThreadQuestionToolCall[]) => Effect.Effect<ThreadQuestionEntry | null, ThreadCallBroke>,
): Effect.fn.Return<ThreadQuestionEntry | null, ThreadCallBroke> {
  for (const step of [...steps].reverse()) {
    const resolved = new Set([
      ...step.toolResults.map((result) => result.toolCallId),
      ...step.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])),
    ]);
    const unresolved: ThreadQuestionToolCall[] = [];
    for (const call of step.toolCalls) {
      if (resolved.has(call.toolCallId)) continue;
      unresolved.push({
        runId: run.id,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      });
    }
    if (unresolved.length === 0) continue;
    const question = yield* questionForTools(unresolved);
    if (question) return question;
    const standing = unresolved.map((call) => `${call.toolName} (${call.toolCallId})`).join(', ');
    return yield* new ThreadCallBroke({
      cause: new Error(
        run.interactive
          ? `The run ended holding tool calls no question can carry: ${standing}.`
          : `The run ended holding tool calls waiting for a reader it does not have: ${standing}.`,
      ),
    });
  }
  return null;
});

export function priorToolRecords(transcript: readonly ThreadTranscriptEntry[], runId: string): readonly AgentToolRecord[] {
  return transcript.filter(entryOf('tool')).flatMap((tool) => {
    if (tool.runId !== runId) return [];
    return [
      {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        input: tool.toolInput,
        output: tool.toolOutput,
        refused: tool.toolState === 'output-denied' ? true : undefined,
      },
    ];
  });
}

export function toolInputFromTranscript(transcript: readonly ThreadTranscriptEntry[], toolCallId: string): unknown {
  const entry = transcript.filter(entryOf('tool')).find((candidate) => candidate.toolCallId === toolCallId);
  if (!entry) throw new Error(`Confirmed tool has no input: ${toolCallId}.`);
  return entry.toolInput;
}

export function questionToolResultEvents(
  transcript: readonly ThreadTranscriptEntry[],
  question: ThreadQuestionEntry,
  results: readonly ToolQuestionResult[],
): ThreadEventBody[] {
  const entries = new Map<string, ThreadToolEntry>();
  for (const tool of transcript.filter(entryOf('tool'))) entries.set(tool.toolCallId, tool);
  return results.map((result) => {
    const existing = entries.get(result.toolCallId);
    const settled = settleTool(result.outcome);
    const base: ThreadToolEntry = existing ?? {
      type: 'tool',
      id: toolEntryId(result.toolCallId),
      runId: question.runId,
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      toolState: settled.toolState,
      occurredAt: new Date().toISOString(),
    };
    return threadEntryEvent({ ...base, ...settled, toolDisplay: result.display });
  });
}

export function questionGuidanceEvents(question: ThreadQuestionEntry): ThreadEventBody[] {
  return question.guidance === undefined ? [] : [threadGuidanceEvent(question.guidance)];
}

export function toolMessageFromResults(results: readonly ToolQuestionResult[]): Message {
  return Message.make({
    role: 'tool',
    content: results.map((result) =>
      ToolResultPart.from({
        id: result.toolCallId,
        name: result.toolName,
        result: result.modelOutput,
        durationMs: result.durationMs,
        retained: result.retained,
      }),
    ),
  });
}

export function cancelledQuestion(
  question: ThreadQuestionEntry,
  reason: string,
): { message: Message; question: ThreadQuestionEntry; results: readonly ToolQuestionResult[] } {
  const output = { status: 'cancelled', reason };
  return endedQuestion(question, { kind: 'cancelled', output }, { type: 'json', value: output });
}

export function refusedQuestion(
  question: ThreadQuestionEntry,
  refusal: ToolRefusal,
): { message: Message; question: ThreadQuestionEntry; results: readonly ToolQuestionResult[] } {
  const output = { status: 'refused', ...refusal };
  return endedQuestion(question, { kind: 'refused', refusal, output }, { type: 'json', value: output });
}

export function unsettledQuestion(
  question: ThreadQuestionEntry,
  reason: string,
): { message: Message; question: ThreadQuestionEntry; results: readonly ToolQuestionResult[] } {
  return endedQuestion(question, { kind: 'failed', error: reason, output: { status: 'failed', reason } }, { type: 'error', value: reason });
}

function endedQuestion(
  question: ThreadQuestionEntry,
  outcome: ToolOutcome,
  modelOutput: AgentToolModelOutput,
): { message: Message; question: ThreadQuestionEntry; results: readonly ToolQuestionResult[] } {
  const results: ToolQuestionResult[] = question.toolCalls.map((call) => ({ ...call, outcome, modelOutput }));
  return {
    message: toolMessageFromResults(results),
    question: { ...question, status: 'cleared', updatedAt: new Date().toISOString() },
    results,
  };
}

export const questionToolResults = Effect.fn('questionToolResults')(function* (input: {
  question: ThreadQuestionEntry;
  answers: readonly ThreadInteractionAnswer[];
  transcript: readonly ThreadTranscriptEntry[];
  options: ToolCallArrival;
  halt: RunStop;
  catalog: ToolCatalog;
  door: AgentToolDoor;
  executing?(): void;
}) {
  const userResults: ToolQuestionResult[] = [];
  for (const call of input.question.toolCalls) {
    if (call.toolName !== USER_QUESTION_TOOL_NAME) continue;
    const output = userAnswerFromQuestion(input.question, call.toolCallId, input.answers);
    if (!output || !Array.isArray(output.answers) || output.answers.length === 0) {
      return yield* new ThreadCallBroke({
        cause: new Error(`Question ${input.question.questionId} has no answer for ${call.toolCallId}; refusing a partial answer.`),
      });
    }
    userResults.push({
      ...call,
      outcome: { kind: 'answered', output: toJson(output) },
      modelOutput: yield* Effect.try({
        try: () =>
          agentToolModelOutput({
            tool: threadUserQuestionTool,
            toolCallId: call.toolCallId,
            caller: input.door.caller,
            toolInput: undefined,
            output,
          }),
        catch: (cause) => new ThreadCallBroke({ cause }),
      }),
    });
  }
  const confirmableCalls = toolCallsFromQuestion(input.question);
  if (confirmableCalls.length === 0) {
    return { results: userResults as readonly ToolQuestionResult[] };
  }
  const inputs = new Map(confirmableCalls.map((call) => [call.toolCallId, toolInputFromTranscript(input.transcript, call.toolCallId)]));
  const reading = readApprovedCalls(input.door, input.catalog, input.question, input.answers, inputs).pipe(
    Effect.mapError((failure) => new ThreadCallBroke({ cause: failure })),
  );
  const stopped = yield* input.halt.cut(reading.pipe(Effect.as(false)), true);
  if (!stopped) input.executing?.();
  const confirmableResults = yield* toolResultsFromQuestion(
    input.door,
    input.catalog,
    input.question,
    input.answers,
    inputs,
    input.options,
    input.halt,
  ).pipe(Effect.mapError((failure) => new ThreadCallBroke({ cause: failure })));
  return { results: [...userResults, ...confirmableResults] as readonly ToolQuestionResult[] };
});

function aggregateQuestionId(runId: string, toolCallIds: readonly string[]): string {
  const digest = sha256()
    .update([runId, ...toolCallIds].join('\0'))
    .digest('base64url')
    .slice(0, 24);
  return `interaction:${digest}`;
}
