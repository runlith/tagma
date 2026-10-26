import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { type ApprovalAnswer, type ApprovalAsk } from '../../platform/contract/wire/approval.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadHarness } from '../../threads/contract/service/engine.js';

const ASKED_OF = 'the operator';

export const approvalAsks =
  (questions: ReturnType<ThreadHarness['Service']['runs']['questions']>) =>
  (request: ApprovalAsk): Effect.Effect<ApprovalAnswer, GateRefusal<'approval-pending'>> => {
    const waitMs = Math.max(0, Math.min(request.waitMs, request.timeoutMs ?? request.waitMs));
    const place = Object.entries(request.route)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => ({ label: key, value: String(value) }));
    const consequence = [request.confirmation.consequence, ...request.reasons.map((reason) => reason.text)]
      .filter((line): line is string => line !== undefined && line !== '')
      .join('\n');
    return questions
      .approve({
        threadId: request.threadId,
        key: request.key,
        operation: request.operation,
        asked: request.reasons.map((reason) => reason.id),
        summary: request.confirmation.summary,
        facts: [...(request.confirmation.facts ?? []), ...place],
        consequence: consequence === '' ? undefined : consequence,
        withinMs: request.timeoutMs,
        waitMs,
      })
      .pipe(
        Effect.catchIf(
          (failure): failure is ThreadStorageFailed => failure instanceof ThreadStorageFailed && failure.call === 'threadLog',
          (failure) => Effect.succeed<ApprovalAnswer>({ _tag: 'Unseated', reason: failure.message }),
        ),
        Effect.map((state): ApprovalAnswer => {
          if ('_tag' in state) return state;
          if (state.kind === 'given') return { _tag: 'Given' };
          if (state.kind === 'declined') return { _tag: 'Declined', by: state.by ?? ASKED_OF, note: state.note };
          if (state.kind === 'lapsed')
            return { _tag: 'Lapsed', questionId: state.questionId, askedOf: ASKED_OF, timeoutMs: state.withinMs };
          return { _tag: 'Waiting', questionId: state.questionId, waitedMs: waitMs };
        }),
        Effect.mapError(
          (failure) =>
            new GateRefusal('approval-pending', `The question for ${request.operation} could not be read or seated: ${String(failure)}`, [
              'read the standing question in this thread, then repeat the act',
            ]),
        ),
      );
  };
