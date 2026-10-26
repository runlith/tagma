import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Result } from 'effect';
import type { AgentEvent } from '../../agent/AgentEvent';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import {
  THREAD_QUESTION_PART,
  THREAD_RUNTIME_GUIDANCE_PART,
  THREAD_TOOL_CONFIRM_KIND,
  THREAD_TRANSCRIPT_PART,
} from '../../transcript/parts';
import { makeThreadStreamSink, type ThreadStreamToolCall } from './ThreadStreamSink';
describe('ThreadStreamSink', () => {
  it.effect(
    'records the opening, guidance and question alongside the tool call in source order',
    Effect.fnUntraced(function* () {
      const events: AgentEvent[] = [];
      const sink = makeThreadStreamSink({
        runId: 'run',
        record: (event) => Effect.sync(() => void events.push(event)),
        questionForTool: (call) => Result.succeed(question(call, 'product.user.question')),
      });
      yield* sink.open([{ type: 'message', id: 'opening' }]);
      yield* sink.push({ type: 'runtime-guidance', entry: { id: 'guide' } as AgentRuntimeGuidance });
      yield* sink.push({ type: 'tool-call', id: 'call', name: 'ask', input: {} });
      yield* sink.push({ type: 'tool-result', id: 'call', name: 'ask', result: { type: 'json', value: true } });
      expect(events.map((event) => event.type)).toEqual([
        `data-${THREAD_TRANSCRIPT_PART}`,
        `data-${THREAD_RUNTIME_GUIDANCE_PART}`,
        'tool-call',
        `data-${THREAD_QUESTION_PART}`,
        'tool-result',
      ]);
      expect(events[3]).toMatchObject({ id: 'question:call' });
    }),
  );
  it.effect(
    'a permission confirmation waits for settlement rather than streaming a provisional question',
    Effect.fnUntraced(function* () {
      const events: AgentEvent[] = [];
      const sink = makeThreadStreamSink({
        runId: 'run',
        record: (event) => Effect.sync(() => void events.push(event)),
        questionForTool: (call) => Result.succeed(question(call, THREAD_TOOL_CONFIRM_KIND)),
      });
      yield* sink.push({ type: 'tool-call', id: 'call', name: 'delete', input: {} });
      expect(events).toEqual([{ type: 'tool-call', id: 'call', name: 'delete', input: {} }]);
    }),
  );
  it.effect(
    'a failed recorder stops the producer with the original failure',
    Effect.fnUntraced(function* () {
      const failure = new Error('recorder lost');
      const sink = makeThreadStreamSink({
        runId: 'run',
        record: () => Effect.die(failure),
        questionForTool: () => Result.succeed(null),
      });
      const result = yield* Effect.exit(sink.push({ type: 'runtime-guidance', entry: { id: 'guide' } as AgentRuntimeGuidance }));
      expect(Exit.isFailure(result) && Cause.squash(result.cause)).toBe(failure);
    }),
  );
});
function question(call: ThreadStreamToolCall, kind: string): ThreadQuestionEntry {
  return {
    type: 'question',
    id: `question:${call.toolCallId}`,
    runId: call.runId,
    questionId: call.toolCallId,
    questions: [{ id: call.toolCallId, toolCallId: call.toolCallId, kind, prompt: 'Confirm?', data: { toolName: call.toolName } }],
    toolCalls: [{ toolCallId: call.toolCallId, toolName: call.toolName }],
    status: 'open',
  };
}
