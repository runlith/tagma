import { Cause, Context, Effect } from 'effect';
import type { ThreadSaid } from '@runlith/agent/thread/run/scheduler/inputs';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { ThreadList } from '../contract/service/list.js';
import { operatorNotice, takeover } from '../contract/wire/settings.js';
import { ThreadLookup, ThreadReading } from '../contract/service/reads.js';

export class ReaderMarking extends Context.Service<
  ReaderMarking,
  {
    wrote(threadId: string): Effect.Effect<void>;
    spoke(threadId: string, projectId: number, text: string, said: ThreadSaid): Effect.Effect<void>;
  }
>()('tagma/threads/ReaderMarking') {}

export type ReaderMarks = ReaderMarking['Service'];

export const makeReaderMarks = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const { find } = yield* ThreadLookup;
  const { advanceReaderOrder } = yield* ThreadReading;
  const mandate = yield* ThreadMandate;
  const settings = yield* Settings;
  const records = yield* ThreadRecords;
  const list = yield* ThreadList;
  const pin = Effect.fn('ReaderMarking.pin')(
    function* (threadId: string, projectId: number) {
      if ((yield* records.facts(threadId))?.pinnedAt === null) yield* list.setPinned(threadId, projectId, true);
    },
    (work, threadId, projectId) =>
      Effect.catchCause(work, (cause) =>
        Effect.logWarning('operator message accepted but the sub-agent was not pinned', {
          threadId,
          projectId,
          cause: Cause.pretty(cause),
        }),
      ),
  );
  return ReaderMarking.of({
    wrote: (threadId) =>
      advanceReaderOrder(threadId).pipe(
        Effect.catchCause((cause) => Effect.logWarning('reader order not advanced', { threadId, cause: Cause.pretty(cause) })),
      ),
    spoke: Effect.fn('ReaderMarking.spoke')(
      function* (threadId, projectId, text, said) {
        const child = yield* find(threadId, OPERATOR_PRINCIPAL);
        if (child?.parentThreadId == null) return;
        yield* pin(threadId, projectId);
        if (yield* settings.value(takeover, projectId)) {
          yield* mandate.setTakenOver(threadId, true);
          for (const reached of yield* records.subtree(threadId)) yield* harness.runs.questions().reroute(reached);
        }
        const asked = yield* mandate.operatorNotice(threadId);
        if (!(asked ?? (yield* settings.value(operatorNotice, projectId)))) return;
        const id = said.status === 'started' ? said.entry.id : said.status === 'queued' ? said.queued.id : said.itemId;
        yield* harness.inputs.deliver(child.parentThreadId, OPERATOR_PRINCIPAL, {
          id: `operator-message:${threadId}:${id}`,
          senderThreadId: null,
          intent: 'message',
          text: [
            `The operator ${said.status === 'queued' ? 'queued words for' : 'addressed'} child thread ${threadId} (run ${said.runId}).`,
            'Their words below apply to that child. Reconcile your outstanding instructions with them before sending more work; this notice requests no additional work.',
            JSON.stringify(text),
          ].join('\n'),
        });
      },
      (work, threadId, projectId) =>
        Effect.catchCause(work, (cause) =>
          Effect.logWarning('operator message accepted but parent notification failed', {
            threadId,
            projectId,
            cause: Cause.pretty(cause),
          }),
        ),
    ),
  });
});
