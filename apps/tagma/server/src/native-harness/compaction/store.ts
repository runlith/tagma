import { Effect } from 'effect';
import type { ThreadCompactionCheckpointRow } from '@runlith/agent/thread/rows';
import { ThreadCompactionConflictError, type ThreadCompactionStorage } from '@runlith/agent/thread/storage/compaction';
import { parseThreadRunUsage } from '@runlith/agent/thread/persisted';
import { and, count, desc, eq, inArray, sum } from 'drizzle-orm';
import { threadCompactionCheckpoint, threadPrunedToolCall } from '../store/thread.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { stored } from '../../platform/store/crossing.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import type { RestedFolds } from '../transcript/restedFolds.js';

export type CheckpointsInput = { readonly onRecords?: (threadId: string, record: unknown) => void; readonly reads?: RestedFolds };

export const makeCompactionStore = Effect.fnUntraced(function* ({
  onRecords = () => {},
  reads,
}: CheckpointsInput): Effect.fn.Return<ThreadCompactionStorage<WriteUnit<'machine'>>, never, MachineStore | MachineUnits> {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    latestCheckpoint: (threadId) =>
      stored('latestCheckpoint')(
        Effect.gen(function* () {
          const rested = reads === undefined ? null : yield* reads.compaction(threadId);
          if (rested !== null) return rested.latest === null ? null : trustedCheckpoint(rested.latest);
          return yield* units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select()
                  .from(threadCompactionCheckpoint)
                  .where(eq(threadCompactionCheckpoint.threadId, threadId))
                  .orderBy(desc(threadCompactionCheckpoint.createdAt), desc(threadCompactionCheckpoint.id))
                  .get(),
              ),
              (checkpoint) => (checkpoint === undefined ? null : trustedCheckpoint(checkpoint)),
            ),
          );
        }),
      ),
    prunedToolCalls: (threadId) =>
      stored('prunedToolCalls')(
        Effect.gen(function* () {
          const rested = reads === undefined ? null : yield* reads.compaction(threadId);
          if (rested !== null) return new Set(rested.calls);
          return yield* units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ toolCallId: threadPrunedToolCall.toolCallId })
                  .from(threadPrunedToolCall)
                  .where(eq(threadPrunedToolCall.threadId, threadId)),
              ),
              (rows) => new Set(rows.map((row) => row.toolCallId)),
            ),
          );
        }),
      ),
    prunedToolCallVolume: (threadId) =>
      stored('prunedToolCallVolume')(
        Effect.gen(function* () {
          const rested = reads === undefined ? null : yield* reads.compaction(threadId);
          if (rested !== null) return rested.pruned;
          return yield* units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ count: count(), tokens: sum(threadPrunedToolCall.tokens) })
                  .from(threadPrunedToolCall)
                  .where(eq(threadPrunedToolCall.threadId, threadId))
                  .get(),
              ),
              (row) => ({ count: row?.count ?? 0, tokens: Number(row?.tokens ?? 0) }),
            ),
          );
        }),
      ),
    compactionCount: (threadId) =>
      stored('compactionCount')(
        Effect.gen(function* () {
          const rested = reads === undefined ? null : yield* reads.compaction(threadId);
          if (rested !== null) return rested.checkpoints;
          return yield* units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ count: count() })
                  .from(threadCompactionCheckpoint)
                  .where(eq(threadCompactionCheckpoint.threadId, threadId))
                  .get(),
              ),
              (row) => row?.count ?? 0,
            ),
          );
        }),
      ),
    markToolCallsPrunedIn: (threadId, calls, unit) =>
      calls.length === 0
        ? Effect.void
        : failedAs(
            'markToolCallsPruned',
            Effect.asVoid(
              unit
                .run(
                  db
                    .insert(threadPrunedToolCall)
                    .values(calls.map((call) => ({ threadId, toolCallId: call.toolCallId, tokens: call.tokens })))
                    .onConflictDoNothing()
                    .returning({ toolCallId: threadPrunedToolCall.toolCallId, tokens: threadPrunedToolCall.tokens }),
                )
                .pipe(
                  Effect.tap((landed) =>
                    unit.afterCommit(
                      Effect.sync(() => {
                        for (const row of landed) onRecords(threadId, { kind: 'pruned', row: { threadId, ...row } });
                      }),
                    ),
                  ),
                ),
            ),
          ),
    retirePrunedToolCallsIn: (threadId, toolCallIds, unit) =>
      toolCallIds.length === 0
        ? Effect.void
        : failedAs(
            'retirePrunedToolCalls',
            Effect.asVoid(
              unit
                .run(
                  db
                    .delete(threadPrunedToolCall)
                    .where(and(eq(threadPrunedToolCall.threadId, threadId), inArray(threadPrunedToolCall.toolCallId, [...toolCallIds])))
                    .returning({ toolCallId: threadPrunedToolCall.toolCallId }),
                )
                .pipe(
                  Effect.tap((retired) =>
                    unit.afterCommit(
                      Effect.sync(() => {
                        for (const row of retired) onRecords(threadId, { kind: 'pruned-retired', row: { threadId, ...row } });
                      }),
                    ),
                  ),
                ),
            ),
          ),
    writeCheckpointIn: (input, unit) => {
      return failedAs(
        'writeCheckpoint',
        Effect.gen(function* () {
          const inserted = yield* unit.run(
            db
              .insert(threadCompactionCheckpoint)
              .values({
                threadId: input.threadId,
                sourceRunId: input.sourceRunId,
                coveredMessageCount: input.coveredMessageCount,
                coveredPrefixHash: input.coveredPrefixHash,
                summary: input.summary,
                usage: input.usage,
              })
              .onConflictDoNothing()
              .returning()
              .get(),
          );
          if (inserted) return { row: trustedCheckpoint(inserted), landed: true };
          const existing = yield* unit.run(
            db
              .select()
              .from(threadCompactionCheckpoint)
              .where(
                and(
                  eq(threadCompactionCheckpoint.threadId, input.threadId),
                  eq(threadCompactionCheckpoint.coveredPrefixHash, input.coveredPrefixHash),
                ),
              )
              .get(),
          );
          if (!existing || existing.coveredPrefixHash !== input.coveredPrefixHash) {
            return yield* Effect.fail(new ThreadCompactionConflictError(input.threadId));
          }
          return { row: trustedCheckpoint(existing), landed: false };
        }).pipe(
          Effect.tap(({ row, landed }) =>
            landed ? unit.afterCommit(Effect.sync(() => onRecords(input.threadId, { kind: 'checkpoint', row }))) : Effect.void,
          ),
          Effect.map(({ row }) => row),
        ),
      );
    },
  };
});

function trustedCheckpoint(row: ThreadCompactionCheckpointRow): ThreadCompactionCheckpointRow {
  return { ...row, usage: parseThreadRunUsage(row.usage) };
}
