import { Clock, type Context, Effect, Result } from 'effect';
import { ToolResultValue } from '@runlith/llm/schema/messages';
import { toJson } from '@runlith/utils/json';
import { documentAsked } from '../../agent/tool';
import { userAnswerFromQuestion, userQuestionFromToolCall } from '../../tools/UserQuestion';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { refused, refusedInput, type Hosted, type HostedCall, type Settled } from './hostedParts';
import type { Questions } from './Questions';
import { ENDED } from './hostedRecords';
import { unansweredOutput } from './ToolQuestion';
export const questioned = Effect.fn('hostedAsks.questioned')(function* (
  questions: Context.Service.Shape<typeof Questions>,
  hosted: Hosted,
  call: HostedCall,
  admit: Effect.Effect<boolean, ThreadBorderFailed>,
): Effect.fn.Return<Settled, ThreadBorderFailed> {
  const parsed = userQuestionFromToolCall(
    { runId: hosted.runId, toolCallId: call.toolCallId, toolName: call.name, input: call.input },
    new Date(yield* Clock.currentTimeMillis).toISOString(),
    () => new Map(Object.entries(hosted.handle.catalog())),
  );
  if (Result.isFailure(parsed)) return refusedInput(parsed.failure, documentAsked(hosted.handle.catalog()[call.name], call.input));
  const entry = parsed.success;
  if (entry === null) return refused(`${call.name} is not a user question.`);
  if (!(yield* admit)) return refused(ENDED);
  const asked = yield* questions.ask({
    threadId: call.threadId,
    runId: hosted.runId,
    toolCallId: call.toolCallId,
    compose: () => Effect.succeed(entry),
  });
  if (asked === null) return refused(`The question ${call.toolCallId} was withdrawn.`);
  if ('refused' in asked) return refused(asked.refused);
  const outcome = asked;
  if (outcome.kind === 'cleared') return refused(`The question ${call.toolCallId} was cleared before it was answered.`);
  if (outcome.kind === 'lapsed') {
    const output = unansweredOutput(outcome.entry, outcome.withinMs, call.name);
    return { output: ToolResultValue.from(output, 'json'), failed: true, settlement: { kind: 'denied', output: toJson(output) } };
  }
  const answer = userAnswerFromQuestion(outcome.entry, call.toolCallId, outcome.answers) ?? { status: 'answered', answers: [] };
  return { output: ToolResultValue.from(answer, 'json'), failed: false, settlement: { kind: 'answered', output: toJson(answer) } };
});
