import { Clock, Effect, Result } from 'effect';
import type { ToolArgumentsInvalid } from '../../agent/ToolArguments';
import type { AgentEvent } from '../../agent/AgentEvent';
import type { AgentEmission } from '../../agent/AgentRunner';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import {
  THREAD_QUESTION_PART,
  THREAD_RUNTIME_GUIDANCE_PART,
  THREAD_READY_ANSWERS_PART,
  THREAD_TRANSCRIPT_PART,
} from '../../transcript/parts';
import { readyAnswersFromToolCall } from '../../tools/ReadyAnswers';
import { isToolConfirmationQuestion, type ToolQuestionResult } from './ToolQuestion';

export type ThreadStreamToolCall = {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ThreadStreamQuestionResult = {
  results: readonly ToolQuestionResult[];
};

export type ThreadStreamSink = ReturnType<typeof makeThreadStreamSink>;

export const makeThreadStreamSink = ({
  runId,
  record,
  questionForTool,
}: {
  readonly runId: string;
  readonly record: (event: AgentEvent) => Effect.Effect<void>;
  readonly questionForTool: (
    call: ThreadStreamToolCall,
    askedAt: string,
  ) => Result.Result<ThreadQuestionEntry | null, ToolArgumentsInvalid>;
}) => ({
  open: Effect.fnUntraced(function* (entries: readonly { type: string; id: string }[], questionResult?: ThreadStreamQuestionResult) {
    for (const result of questionResult?.results ?? []) {
      yield* record({ type: 'tool-call', id: result.toolCallId, name: result.toolName, input: {} });
      if (result.display) yield* record({ type: 'tool-display', toolCallId: result.toolCallId, display: result.display });
      yield* record({
        type: 'tool-outcome',
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        outcome: result.outcome,
      });
    }
    for (const entry of entries) yield* record({ type: `data-${THREAD_TRANSCRIPT_PART}`, id: entry.id, data: entry });
  }),

  push: Effect.fnUntraced(function* (part: AgentEmission) {
    if (part.type === 'runtime-guidance') {
      yield* record({ type: `data-${THREAD_RUNTIME_GUIDANCE_PART}`, id: part.entry.id, data: part.entry });
      return;
    }
    yield* record(part);
    if (part.type !== 'tool-call') return;
    const call = { runId, toolCallId: part.id, toolName: part.name, input: part.input };
    const question = questionForTool(call, new Date(yield* Clock.currentTimeMillis).toISOString());
    if (Result.isSuccess(question) && question.success !== null && !isToolConfirmationQuestion(question.success)) {
      const entry = question.success;
      yield* record({ type: `data-${THREAD_QUESTION_PART}`, id: entry.id, data: entry });
    }
    const readyAnswers = readyAnswersFromToolCall(call);
    if (Result.isSuccess(readyAnswers) && readyAnswers.success !== null) {
      const entry = readyAnswers.success;
      yield* record({ type: `data-${THREAD_READY_ANSWERS_PART}`, id: entry.id, data: entry });
    }
  }),
});
