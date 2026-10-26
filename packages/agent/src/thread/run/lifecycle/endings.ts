import { Clock, Context, Data, Effect, Layer } from 'effect';
import { mintCursor, readCursor, type Cursor, type PageQuestion } from '@runlith/paging';
import { EndingStages, type ThreadRunStoppedBy } from '../../ending';
import { actDigest } from '../../keyed';
import type { ThreadRunRow } from '../../rows';
import type { RunTerminalStatus } from '../../../transcript/live';
import type { WithdrawnWords } from '../../../transcript/entries';
import { threadNotification, type ThreadNotification } from '../../storage/settlement';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { ThreadOwner, ThreadSettlementRhythm, ThreadRunStoreFactory, type ThreadWriteTx } from '../../ThreadPorts';
import { controlIfPresent, transitionDeps } from '../../transition/kernel';
import type { Decision } from '../../transition/port';
import { runEnded } from './closing';
export type RunEnding = {
  readonly runId: string;
  readonly threadId: string;
  readonly status: RunTerminalStatus;
  readonly stoppedBy: ThreadRunStoppedBy | null;
  readonly failureReason: string | null;
  readonly finishedAt: Date;
  readonly notification: ThreadNotification;
  readonly words: WithdrawnWords | null;
};
export type RunEndingsPage = {
  readonly rows: readonly RunEnding[];
  readonly total: number;
  readonly cursor: Cursor | null;
};
export type Redelivery = 'redelivering' | 'not-exhausted' | 'run-not-found';
export class ThreadCursorRefused extends Data.TaggedError('ThreadCursorRefused')<{
  readonly refused: 'bad-cursor' | 'cursor-stale';
}> {}
export class RunEndings extends Context.Service<
  RunEndings,
  {
    page(input: {
      readonly threadIds: readonly string[];
      readonly limit: number;
      readonly cursor?: Cursor;
    }): Effect.Effect<RunEndingsPage, ThreadPortFailure | ThreadCursorRefused>;
    newest(threadIds: readonly string[], depth: number): Effect.Effect<readonly RunEnding[], ThreadPortFailure>;
    redeliver(threadId: string, runId: string): Effect.Effect<Redelivery, ThreadPortFailure>;
    restore(threadId: string, runId: string): Effect.Effect<void, ThreadPortFailure>;
  }
>()('@runlith/agent/RunEndings') {}
export const runEndingsLayer = Layer.effect(
  RunEndings,
  Effect.gen(function* () {
    const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    const rhythm = yield* ThreadSettlementRhythm;
    const stages = yield* EndingStages;
    const kernel = yield* transitionDeps;
    const ending = (row: ThreadRunRow, now: Date): RunEnding => ({
      runId: row.id,
      threadId: row.threadId,
      status: row.status as RunEnding['status'],
      stoppedBy: row.settledBy,
      failureReason: row.failureReason,
      finishedAt: row.finishedAt as Date,
      notification: threadNotification(row, rhythm, now) as ThreadNotification,
      words: row.withdrawnWords,
    });
    return RunEndings.of({
      page: Effect.fn('RunEndings.page')(function* (input) {
        const question: PageQuestion = { operation: 'run-endings.page', selection: { threads: [...input.threadIds].sort() }, order: 0 };
        const reading = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (reading !== null && 'refused' in reading) return yield* new ThreadCursorRefused({ refused: reading.refused });
        const at = reading?.at;
        const after =
          at !== undefined && typeof at[0] === 'number' && typeof at[1] === 'string'
            ? { finishedAt: new Date(at[0]), id: at[1] }
            : undefined;
        if (at !== undefined && after === undefined) return yield* new ThreadCursorRefused({ refused: 'bad-cursor' });
        const settled = yield* runs.settledRuns({
          threadIds: input.threadIds,
          limit: input.limit + 1,
          after: after,
        });
        const now = new Date(yield* Clock.currentTimeMillis);
        const rows = settled.rows.slice(0, input.limit).map((row) => ending(row, now));
        const last = rows[rows.length - 1];
        return {
          rows,
          total: settled.total,
          cursor: settled.rows.length > input.limit && last ? mintCursor(question, [last.finishedAt.getTime(), last.runId]) : null,
        };
      }),
      newest: Effect.fn('RunEndings.newest')(function* (threadIds, depth) {
        if (threadIds.length === 0) return [];
        const rows = yield* runs.newestSettled(threadIds, depth);
        const now = new Date(yield* Clock.currentTimeMillis);
        return rows.map((row) => ending(row, now));
      }),
      redeliver: Effect.fn('RunEndings.redeliver')(function* (threadId, runId) {
        if ((yield* runs.runById(runId))?.threadId !== threadId) return 'run-not-found' as const;
        const rearmed = yield* runs.redeliverSettled(runId, rhythm.settledNotifyAttemptLimit);
        return rearmed ? ('redelivering' as const) : ('not-exhausted' as const);
      }),
      restore: (threadId, runId) =>
        Effect.asVoid(
          controlIfPresent<undefined, ThreadWriteTx, ThreadPortFailure>(
            kernel,
            threadId,
            {
              decide: Effect.fnUntraced(function* (row, tx) {
                const run = yield* runs.runById(runId, tx);
                if (!run || run.threadId !== threadId || run.status === 'running') {
                  return { refuse: undefined } as Decision<undefined, ThreadWriteTx, ThreadPortFailure>;
                }
                const ofRun = yield* kernel.store.entriesOfRun(threadId, runId, tx);
                return {
                  apply: true,
                  result: undefined,
                  participants: (unit) =>
                    stages.record(runEnded(run, row.ownerId, [...ofRun, ...(run.streamTail ?? [])], row.contextReading), unit),
                } as Decision<undefined, ThreadWriteTx, ThreadPortFailure>;
              }),
            },
            { evidence: { decidedBy: `restore-ending:${runId}` }, digest: actDigest(['restore-ending', runId]) },
          ),
        ),
    });
  }),
);
