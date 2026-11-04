import { CurrentCost, rootCost } from '@runlith/performance/CostLedger';
import { Clock, Duration, Effect, Queue, Stream } from 'effect';
import { RETAINED_DETAIL_MS } from '../../executions/contract/wire/requestKeys.js';
import {
  HOST_REPLACED,
  UNATTRIBUTED_MOVE,
  Custody,
  type CustodyNotice,
  type CustodyNoticeCursor,
  type TerminalDisplaced,
} from '../../executions/contract/service/custody.js';
import type { CommandSignalSend } from './commandEndings.js';

export const TERMINAL_CUSTODY_SIGNAL = 'terminal-custody';

export const NOTICE_PAGE = 200;

export const CUSTODY_NOTICE_PASS_MS = 30_000;

const who = (requester: string): string =>
  requester === 'operator' ? 'The operator' : requester.startsWith('thread:') ? `Thread ${requester.slice('thread:'.length)}` : requester;

export const custodyNoticeText = (notice: CustodyNotice): string =>
  notice.requester === HOST_REPLACED
    ? [
        `Terminal ${notice.name} is gone: the execution host that ran it was replaced, and its process and its output went with it.`,
        ``,
        `execution: ${notice.execution.execution}:${notice.execution.incarnation} — nothing reads or types into it any more; start it again if you still need it.`,
      ].join('\n')
    : [
        notice.requester === UNATTRIBUTED_MOVE
          ? `Terminal ${notice.name} changed hands; it is no longer yours.`
          : `${who(notice.requester)} took over terminal ${notice.name}; it is no longer yours.`,
        ``,
        `execution: ${notice.execution.execution}:${notice.execution.incarnation} — typing, interrupting and resizing it from here are refused; reading its screen and output still works.`,
      ].join('\n');

export const custodySignalId = (notice: { readonly projectId: number; readonly operationId: string }): string =>
  `custody:${notice.projectId}:${notice.operationId}`;

export type CustodyNotices = Effect.Success<ReturnType<typeof makeCustodyNotices>>;

export const makeCustodyNotices = Effect.fnUntraced(function* ({ send }: { readonly send: CommandSignalSend }) {
  const custody = yield* Custody;
  const deliver = Effect.fn('CustodyNotices.deliver')(
    function* (read: CustodyNotice) {
      const decided = yield* custody.noticeDecided(read);
      if (decided._tag === 'Undecided') return 'kept' as const;
      if (decided._tag === 'Gone') return 'delivered' as const;
      const notice = decided.notice;
      const settle = Effect.as(custody.noticeDelivered(notice), 'delivered' as const);
      const displaced = notice.requester === HOST_REPLACED ? true : yield* custody.stillDisplaced(notice);
      if (displaced === null) return 'kept' as const;
      if (!displaced) {
        yield* Effect.logInfo('a custody notice is dropped: the thread holds the terminal again', {
          thread: notice.thread,
          execution: notice.execution.execution,
        });
        return yield* settle;
      }
      const sent = yield* send({
        threadId: notice.thread,
        id: custodySignalId(notice),
        text: custodyNoticeText(notice),
      });
      if (sent._tag === 'Unreachable') {
        const expired = (yield* Clock.currentTimeMillis) - notice.openedAt >= RETAINED_DETAIL_MS;
        yield* Effect.logInfo(
          expired
            ? 'a thread owed a custody notice stayed unreachable for the retention window; the notice is given up'
            : 'a thread owed a custody notice could not be reached; the notice stands',
          { thread: notice.thread, execution: notice.execution.execution, reason: sent.reason },
        );
        return expired ? yield* settle : ('kept' as const);
      }
      if (sent._tag !== 'Accepted') {
        yield* Effect.logInfo('a custody notice is owed where nobody receives it; it ends with the reason', {
          thread: notice.thread,
          answer: sent._tag,
          reason: 'reason' in sent ? sent.reason : undefined,
        });
      }
      return yield* settle;
    },
    (work, read) =>
      Effect.catch(work, (failure) =>
        Effect.logWarning('a custody notice could not be read or settled; the obligation stands for the next pass', {
          operationId: read.operationId,
          thread: read.thread,
          failure,
        }).pipe(Effect.as('kept' as const)),
      ),
  );

  const pass: () => Effect.Effect<number> = Effect.fn('CustodyNotices.pass')(function* () {
    let kept = 0;
    let after: CustodyNoticeCursor | undefined;
    for (;;) {
      const page = yield* Effect.result(custody.pendingNotices(NOTICE_PAGE, after));
      if (page._tag === 'Failure') {
        yield* Effect.logWarning('the custody notices owed could not be read; the rest wait for the next pass', {
          reason: page.failure._tag,
        });
        return kept;
      }
      for (const notice of page.success) if ((yield* deliver(notice)) === 'kept') kept += 1;
      const last = page.success[page.success.length - 1];
      if (last === undefined || page.success.length < NOTICE_PAGE) return kept;
      after = { openedAt: last.openedAt, projectId: last.projectId, operationId: last.operationId };
    }
  });

  const attend = (moved: Queue.Dequeue<TerminalDisplaced>, everyMs: number): Effect.Effect<never> =>
    Stream.merge(Stream.fromQueue(moved).pipe(Stream.map(() => undefined)), Stream.tick(Duration.millis(everyMs))).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.runForEach(() => rootCost('CustodyNotices.pass', pass()).pipe(Effect.provideService(CurrentCost, null))),
      Effect.andThen(Effect.never),
    );
  return { deliver, pass, attend };
});
