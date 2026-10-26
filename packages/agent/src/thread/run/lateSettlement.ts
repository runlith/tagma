import { Cause, Clock, Effect, Exit } from 'effect';
import type { CallHooks } from '../../agent/AgentCalls';
import { agentToolRefusal } from '../../agent/AgentFailure';
import { doorToolOutcome } from '../../agent/door/types';
import type { ToolOutcome } from '../../agent/tool';
import { coreEntry } from '../../transcript/kinds';
import { toolEntryId } from '../../transcript/entryNames';
import { threadEntryEvent } from '../events';
import { actDigest } from '../keyed';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadFeed, ThreadToolOutputScopeFaces, ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { answerOf, transitionNow, type TransitionDeps } from '../transition/kernel';
import { settledToolEntry } from './ThreadToolRecords';

export const settledLate = Effect.fnUntraced(function* (
  kernel: TransitionDeps<ThreadTx, ThreadWriteTx>,
  feed: ThreadFeed['Service'],
  toolOutputs: ThreadToolOutputScopeFaces,
  threadId: string,
  runId: string,
  call: Parameters<CallHooks['completed']>[0],
  exit: Parameters<CallHooks['completed']>[1],
): Effect.fn.Return<void, ThreadBorderFailed> {
  const id = toolEntryId(call.toolCallId);
  const refusal = Exit.isFailure(exit) ? agentToolRefusal(Cause.squash(exit.cause)) : null;
  const outcome: ToolOutcome = Exit.isSuccess(exit)
    ? doorToolOutcome(exit.value)
    : refusal === null
      ? { kind: 'failed', error: Cause.pretty(exit.cause) }
      : { kind: 'refused', refusal };
  const key = { call: { namespace: `background:${runId}`, id: call.toolCallId } };
  yield* feed.atCut(
    threadId,
    transitionNow<void, ThreadWriteTx, ThreadBorderFailed, ThreadTx>(
      kernel,
      threadId,
      {
        declared: [],
        decide: Effect.fnUntraced(function* (_view, tx) {
          const original = yield* kernel.store.entryById(threadId, id, tx);
          if (original === undefined || !coreEntry(original) || original.type !== 'tool') {
            return yield* new ThreadCallBroke({
              cause: new Error(`The background call ${call.toolCallId} has no recorded tool entry.`),
            });
          }
          const entry = settledToolEntry(
            {
              id: original.id,
              runId,
              toolName: original.toolName,
              toolCallId: call.toolCallId,
              input: original.toolInput,
              occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            },
            outcome,
            Exit.isSuccess(exit) ? exit.value.display : original.toolDisplay,
            original.execution,
          );
          return {
            apply: true,
            result: undefined,
            events: [threadEntryEvent(entry)],
            participants: (unit: ThreadWriteTx) => toolOutputs.commitReferenced([], [entry], unit),
          } as const;
        }),
      },
      { evidence: key, digest: actDigest(key) },
    ).pipe(Effect.flatMap((answer) => answerOf(threadId, answer))),
  );
});
