import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { Effect } from 'effect';
import type { CallAddress, CallRecord } from '@runlith/agent/callProgress';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { threadRecord } from '../../thread-record/store/table.js';
import type { OwedScope } from '../contract/service/owedCalls.js';
import { owedCall } from './calls.js';

export type OwedRow = typeof owedCall.$inferSelect;

export type OwedOutcome = NonNullable<OwedRow['outcome']>;

export type OwedEnding = {
  readonly outcome: OwedOutcome;
  readonly words: string;
  readonly endedAt: Date;
  readonly threads: OwedRow['threads'];
};

export type OwedCallRows = Effect.Success<typeof makeOwedCallRows>;

const at = (address: CallAddress) => and(eq(owedCall.runId, address.runId), eq(owedCall.toolCallId, address.toolCallId));

export const makeOwedCallRows = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  return {
    owe: (unit: WriteUnit<'machine'>, call: CallRecord, threadId: string, epoch: string) =>
      Effect.asVoid(
        unit.run(
          db
            .insert(owedCall)
            .values({
              runId: call.runId,
              toolCallId: call.toolCallId,
              threadId,
              name: call.name,
              input: call.input ?? null,
              epoch,
              openedAt: new Date(call.startedAt),
              unstarted: call.admittedAt === null ? true : null,
            })
            .onConflictDoNothing(),
        ),
      ),
    began: (unit: WriteUnit<'machine'>, address: CallAddress) =>
      Effect.asVoid(unit.run(db.update(owedCall).set({ unstarted: null }).where(at(address)))),
    end: (unit: WriteUnit<'machine'>, address: CallAddress, ending: OwedEnding) =>
      Effect.map(
        unit.run(
          db
            .update(owedCall)
            .set(ending)
            .where(and(at(address), isNull(owedCall.outcome)))
            .returning({ runId: owedCall.runId }),
        ),
        (rows) => rows.length > 0,
      ),
    ended: (unit: WriteUnit<'machine'>, row: OwedRow) =>
      Effect.map(
        unit.run(db.insert(owedCall).values(row).onConflictDoNothing().returning({ runId: owedCall.runId })),
        (rows) => rows.length > 0,
      ),
    carried: (unit: WriteUnit<'machine'>, threadId: string, address: CallAddress) =>
      Effect.asVoid(unit.run(db.delete(owedCall).where(and(at(address), eq(owedCall.threadId, threadId), isNull(owedCall.outcome))))),
    settle: (unit: WriteUnit<'machine'>, address: CallAddress) =>
      Effect.map(unit.run(db.delete(owedCall).where(at(address)).returning({ runId: owedCall.runId })), (rows) => rows.length > 0),
    row: (unit: Unit<'machine'>, address: CallAddress) =>
      Effect.map(unit.run(db.select().from(owedCall).where(at(address)).all()), (rows): OwedRow | null => rows[0] ?? null),
    owing: (unit: Unit<'machine'>, threads: readonly string[] | undefined) =>
      threads?.length === 0
        ? Effect.succeed([])
        : Effect.map(
            unit.run(
              db
                .selectDistinct({ thread: owedCall.threadId })
                .from(owedCall)
                .where(threads === undefined ? undefined : inArray(owedCall.threadId, [...threads]))
                .all(),
            ),
            (rows): readonly string[] => rows.map((row) => row.thread),
          ),
    of: (unit: Unit<'machine'>, scope: OwedScope) =>
      Effect.map(
        unit.run(
          db
            .select({ owed: owedCall })
            .from(owedCall)
            .innerJoin(threadRecord, eq(threadRecord.id, owedCall.threadId))
            .where(
              and(
                scope.threadId === undefined ? undefined : eq(owedCall.threadId, scope.threadId),
                scope.projectId === undefined ? undefined : eq(threadRecord.projectId, scope.projectId),
              ),
            )
            .orderBy(asc(owedCall.openedAt), asc(owedCall.runId), asc(owedCall.toolCallId))
            .all(),
        ),
        (rows): readonly OwedRow[] => rows.map((row) => row.owed),
      ),
    orphaned: (unit: WriteUnit<'machine'>, epoch: string, endedAt: Date, words: string) =>
      Effect.map(
        unit.run(
          db
            .update(owedCall)
            .set({ outcome: 'interrupted', words, endedAt })
            .where(and(ne(owedCall.epoch, epoch), isNull(owedCall.outcome), isNull(owedCall.unstarted)))
            .returning({ runId: owedCall.runId }),
        ),
        (rows) => rows.length,
      ),
    unstarted: (unit: Unit<'machine'>, epoch: string) =>
      unit.run(
        db
          .select({ runId: owedCall.runId, toolCallId: owedCall.toolCallId, threadId: owedCall.threadId })
          .from(owedCall)
          .where(and(ne(owedCall.epoch, epoch), isNull(owedCall.outcome), eq(owedCall.unstarted, true)))
          .all(),
      ),
    interrupt: (unit: WriteUnit<'machine'>, address: CallAddress, words: string, endedAt: Date) =>
      Effect.asVoid(
        unit.run(
          db
            .update(owedCall)
            .set({ outcome: 'interrupted', words, endedAt })
            .where(and(at(address), isNull(owedCall.outcome))),
        ),
      ),
  };
});
