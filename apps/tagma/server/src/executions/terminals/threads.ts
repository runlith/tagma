import { and, eq, isNotNull } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';

export type TerminalThread = {
  readonly projectId: number;
  readonly live: boolean;
};

export type TerminalThreads = ReturnType<typeof makeTerminalThreads>;

export const makeTerminalThreads = ({ db }: { readonly db: StoreDb<'machine'> }) => ({
  read: Effect.fn('TerminalThreads.read')(function* (threadId: ThreadId): Effect.fn.Return<TerminalThread | null, TerminalUnavailable> {
    const rows = yield* db
      .select({ projectId: recordFacts.projectId, archivedAt: recordFacts.archivedAt })
      .from(recordFacts)
      .where(and(eq(recordFacts.id, threadId), isNotNull(recordFacts.projectId)))
      .limit(1)
      .pipe(
        Effect.mapError(
          () =>
            new TerminalUnavailable({
              owner: 'store',
              message: `The thread register could not say whether ${threadId} can take custody; nothing was moved.`,
            }),
        ),
      );
    const row = rows[0];
    if (row === undefined || row.projectId === null) return null;
    return { projectId: row.projectId, live: row.archivedAt === null };
  }),
});
