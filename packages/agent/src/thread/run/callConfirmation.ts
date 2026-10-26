import { Clock, Effect } from 'effect';
import { AgentHostFailed } from '../../agent/AgentFailure';
import type { CallRecord } from '../../agent/callProgress';
import type { AgentCallQuestion, AgentCallVerdict } from '../../agent/door/types';
import type { ModeOf } from '../../modes/ApprovalMode';
import { DECLINED } from './hostedParts';
import { approvalScope } from './pendingSlot';
import type { QuestionOutcome, QuestionRefusal } from './Questions';
import type { AskQuestion } from './scheduler/intake';
import { confirmedByReader, declinedOutput, toolQuestionOf, unansweredOutput } from './ToolQuestion';

const MOVED = 'The call moved to the background, and its question moved with it to the thread.';

const verdictOf = (asked: QuestionOutcome | QuestionRefusal | null, call: CallRecord): AgentCallVerdict => {
  if (asked === null) return { allowed: true };
  if ('refused' in asked) return { allowed: false, output: { status: 'refused', reason: asked.refused } };
  if (asked.kind === 'lapsed') return { allowed: false, output: unansweredOutput(asked.entry, asked.withinMs, call.name) };
  if (asked.kind === 'cleared') {
    if (asked.refusal !== undefined) return { allowed: false, refusal: asked.refusal, output: { status: 'refused', ...asked.refusal } };
    return asked.reason === undefined
      ? { allowed: false, output: { status: 'cancelled', reason: DECLINED } }
      : { allowed: false, stopped: true, output: { status: 'cancelled', reason: asked.reason } };
  }
  return confirmedByReader(asked.answers, call.toolCallId)
    ? { allowed: true }
    : { allowed: false, output: declinedOutput(asked.entry, call.name) };
};

export const callConfirmation = (ask: AskQuestion, modeOf: ModeOf) =>
  Effect.fn('callConfirmation')(
    function* (call: CallRecord, question: AgentCallQuestion) {
      const threadId = call.threadId;
      if (threadId === null) {
        return {
          allowed: false,
          output: { status: 'refused', reason: `${call.name} has no thread whose reader could be asked.` },
        } as const;
      }
      for (;;) {
        const background = question.background();
        const scope = background ? approvalScope(threadId) : call.runId;
        let moving = false;
        const stopped = background
          ? question.stopped
          : Effect.raceFirst(
              question.stopped,
              question.moved.pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    moving = true;
                  }),
                ),
                Effect.as({ toolCallId: call.toolCallId, reason: MOVED }),
              ),
            );
        const asked = yield* ask({
          threadId,
          runId: scope,
          toolCallId: call.toolCallId,
          withinMs: question.prepared.reader?.withinMs,
          stopped,
          unasked: () => modeOf().confirmsWaiting === true,
          compose: Effect.fnUntraced(function* () {
            const entry = toolQuestionOf(
              { runId: scope, toolCallId: call.toolCallId, toolName: call.name, input: question.prepared.rawInput },
              question.prepared,
              new Date(yield* Clock.currentTimeMillis).toISOString(),
            );
            return entry ?? { refused: `${call.name} could not be put to the user for confirmation.` };
          }),
        });
        if (moving && asked !== null && !('refused' in asked) && asked.kind === 'cleared') continue;
        return verdictOf(asked, call);
      }
    },
    (effect) => Effect.mapError(effect, (cause) => new AgentHostFailed({ port: 'tools', cause })),
  );
