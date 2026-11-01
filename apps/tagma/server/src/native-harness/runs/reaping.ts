import { Clock, Effect } from 'effect';
import type { ThreadRunRow, ThreadRunStage } from '@runlith/agent/thread/rows';
import { RUN_ENDINGS } from '@runlith/agent/transcript/live';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import {
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  type ThreadRunAdoptPatch,
  type ThreadRunCutPatch,
  type ThreadRunReapPatch,
  type ThreadRunReapResult,
  type ThreadRunReapSelector,
} from '@runlith/agent/thread/storage/runs';
import {
  parseThreadRunFailure,
  parseThreadRunNotification,
  parseThreadSettledBy,
  parseThreadRunProgress,
  parseThreadRunStopRequest,
  parseWithdrawnWords,
  parseThreadRunUsage,
  parseThreadStreamTail,
} from '@runlith/agent/thread/persisted';
import { seedThreadNotification, type ThreadNotificationRecord } from '@runlith/agent/thread/storage/settlement';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, type Placeholder, type SQL, sql } from 'drizzle-orm';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { type WriteSet, writes } from '../../platform/contract/service/writes.js';
import { runRows, threadRun, threadRunTally } from '../../threads/store/kernel.js';
import type { EndedRuns } from './endedRuns.js';
import { recordRows, threadRecord } from '../../thread-record/store/table.js';
import { spellRows, threadLiveSpell } from '../../threads/store/mandate.js';
import type { ThreadStatusMove } from '../../thread-record/contract/service/records.js';
import { stored, trusted, type StoredFailure } from '../../platform/store/crossing.js';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';

export type RunLifecycle = {
  readonly started: (threadId: string, at: Date, tx: Unit<'machine'>) => Effect.Effect<void, StoreFailure>;
  readonly settled: (threadId: string, tx: Unit<'machine'>) => Effect.Effect<void, StoreFailure>;
};

export type LedgerParts = {
  readonly ownerId: string;
  readonly scope: SQL;
  readonly lifecycle: RunLifecycle | undefined;
  readonly ended: EndedRuns;
  readonly publish: (unit: WriteUnit<'machine'>, threadId: string, move: ThreadStatusMove) => Effect.Effect<boolean, StoreFailure>;
};

export type Reaping = ReturnType<Effect.Success<typeof makeReaping>>;

export const stageText = (progress: ThreadRunStage): string =>
  JSON.stringify({ stage: progress.stage, message: progress.message, halt: progress.halt });

export const stagedFrom = (stage: string | Placeholder): SQL =>
  sql`case when ${threadRun.progress} -> '$.phase' is null then json(${stage}) else json_set(json(${stage}), '$.phase', ${threadRun.progress} -> '$.phase') end`;

export const staged = (progress: ThreadRunStage): SQL => stagedFrom(stageText(progress));

export const makeReaping = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const clock = yield* Clock.Clock;

  const writing = <A>(set: WriteSet, work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, StoredFailure>, tx?: WriteUnit<'machine'>) =>
    tx ? work(tx) : units.write(set, work);

  return ({ ownerId, scope, lifecycle, ended, publish }: LedgerParts) => {
    const reapClaim = (selector: ThreadRunReapSelector): SQL | undefined => {
      const claim =
        selector.kind === 'handed-over'
          ? and(ne(threadRun.ownerId, ownerId), isNotNull(threadRun.handedOverAt))
          : selector.kind === 'foreign-owner'
            ? and(ne(threadRun.ownerId, ownerId), isNull(threadRun.handedOverAt), lt(threadRun.heartbeatAt, selector.heartbeatBefore))
            : selector.kind === 'dropped'
              ? eq(threadRun.ownerId, ownerId)
              : and(eq(threadRun.ownerId, ownerId), lt(threadRun.heartbeatAt, selector.heartbeatBefore));
      return and(
        eq(threadRun.status, 'running'),
        claim,
        sql`json_extract(${threadRun.progress}, '$.stage') is not ${THREAD_RUN_AWAITING_QUESTION_STAGE}`,
        scope,
      );
    };

    const notificationClaim = (runId: string, expectedId: string | null): SQL =>
      and(
        eq(threadRun.id, runId),
        eq(threadRun.ownerId, ownerId),
        ne(threadRun.status, 'running'),
        isNull(threadRun.settledNotifiedAt),
        expectedId === null
          ? isNull(threadRun.settledNotification)
          : sql`json_extract(${threadRun.settledNotification}, '$.id') = ${expectedId}`,
      ) as SQL;

    const ending = Effect.fnUntraced(function* (
      unit: WriteUnit<'machine'>,
      call: string,
      run: ThreadRunRow,
      streamTail: ThreadRunRow['streamTail'],
    ) {
      yield* publish(unit, run.threadId, { run: { to: null, expected: run.id } });
      yield* ended.tally(unit, run);
      if (lifecycle) yield* lifecycle.settled(run.threadId, unit);
      return yield* trustedRun(kinds, call, { ...run, streamTail });
    });

    const notified = (call: string, write: (unit: WriteUnit<'machine'>) => Effect.Effect<readonly { id: string }[], StoredFailure>) =>
      stored(call)(units.write(writes(`ThreadRunStore.${call}`, [runRows]), write).pipe(Effect.map((rows) => rows.length === 1)));

    return {
      ending,
      reapableRuns: (
        selector: ThreadRunReapSelector,
        limit?: number,
      ): Effect.Effect<readonly ThreadRunReapResult[], ThreadStorageFailed> => {
        const query = db
          .select({
            id: threadRun.id,
            threadId: threadRun.threadId,
            kind: threadRun.kind,
            handedOverAt: threadRun.handedOverAt,
            heartbeatAt: threadRun.heartbeatAt,
            stopRequest: threadRun.stopRequest,
          })
          .from(threadRun)
          .where(reapClaim(selector))
          .orderBy(desc(sql`coalesce(${threadRun.handedOverAt}, ${threadRun.heartbeatAt})`), asc(threadRun.id));
        return stored('reapableRuns')(
          units.read((unit) =>
            Effect.flatMap(unit.run(limit === undefined ? query : query.limit(limit)), (rows) =>
              trusted('reapableRuns', () => rows.map((row) => ({ ...row, stopRequest: parseThreadRunStopRequest(row.stopRequest) }))),
            ),
          ),
        );
      },
      reapRun: (runId: string, input: { selector: ThreadRunReapSelector } & ThreadRunReapPatch, tx?: WriteUnit<'machine'>) => {
        const claim = and(eq(threadRun.id, runId), reapClaim(input.selector));
        return stored('reapRun')(
          writing(
            writes('ThreadRunStore.reapRun', [runRows, threadRunTally, recordRows, spellRows]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(
                  db.select({ streamTail: threadRun.streamTail, stopRequest: threadRun.stopRequest }).from(threadRun).where(claim).get(),
                );
                if (!current) return null;
                const stopped = parseThreadRunStopRequest(current.stopRequest);
                const run = yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      status: stopped === null ? 'failed' : 'aborted',
                      ownerId,
                      failureReason: stopped === null ? input.failureReason : null,
                      failure: stopped === null ? (input.failure ?? null) : null,
                      progress: stopped === null ? input.progress : { stage: 'aborted', message: 'Thread run stopped.' },
                      finishedAt: input.finishedAt,
                      settledBy: stopped?.by ?? null,
                      settledNotification: seedThreadNotification(runId, input.finishedAt, null),
                      heartbeatAt: input.finishedAt,
                      streamTail: null,
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(claim)
                    .returning()
                    .get(),
                );
                if (!run) return null;
                return yield* ending(unit, 'reapRun', run, current.streamTail);
              }),
            tx,
          ),
        );
      },
      handOverRuns: (runIds: readonly string[], at: Date, tx?: WriteUnit<'machine'>): Effect.Effect<void, ThreadStorageFailed> =>
        runIds.length === 0
          ? Effect.void
          : stored('handOverRuns')(
              writing(
                writes('ThreadRunStore.handOverRuns', [runRows]),
                (unit) =>
                  unit.run(
                    db
                      .update(threadRun)
                      .set({ handedOverAt: at, updatedAt: new Date(clock.currentTimeMillisUnsafe()) })
                      .where(
                        and(
                          inArray(threadRun.id, [...runIds]),
                          eq(threadRun.ownerId, ownerId),
                          eq(threadRun.status, 'running'),
                          isNull(threadRun.handedOverAt),
                        ),
                      ),
                  ),
                tx,
              ),
            ),
      cutRun: (runId: string, input: { selector: ThreadRunReapSelector } & ThreadRunCutPatch, tx?: WriteUnit<'machine'>) => {
        const claim = and(eq(threadRun.id, runId), reapClaim(input.selector));
        return stored('cutRun')(
          writing(
            writes('ThreadRunStore.cutRun', [runRows, threadRunTally, recordRows, spellRows]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(db.select({ streamTail: threadRun.streamTail }).from(threadRun).where(claim).get());
                if (!current) return null;
                const run = yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      status: 'cut',
                      ownerId,
                      failureReason: input.failureReason ?? null,
                      failure: null,
                      progress: input.progress,
                      finishedAt: input.finishedAt,
                      settledBy: null,
                      settledNotification: seedThreadNotification(runId, input.finishedAt, null),
                      heartbeatAt: input.finishedAt,
                      streamTail: null,
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(claim)
                    .returning()
                    .get(),
                );
                if (!run) return null;
                return yield* ending(unit, 'cutRun', run, current.streamTail);
              }),
            tx,
          ),
        );
      },
      adoptRun: (
        runId: string,
        input: { selector: ThreadRunReapSelector; maxResumes: number } & ThreadRunAdoptPatch,
        tx?: WriteUnit<'machine'>,
      ) => {
        const handedOver = input.selector.kind === 'handed-over';
        const claim = and(
          eq(threadRun.id, runId),
          reapClaim(input.selector),
          isNull(threadRun.stopRequest),
          handedOver ? undefined : lt(threadRun.resumes, input.maxResumes),
        );
        return stored('adoptRun')(
          writing(
            writes('ThreadRunStore.adoptRun', [runRows, recordRows]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(
                  db.select({ streamTail: threadRun.streamTail, resumes: threadRun.resumes }).from(threadRun).where(claim).get(),
                );
                if (!current) return null;
                const run = yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      ownerId,
                      progress: staged(input.progress),
                      heartbeatAt: input.heartbeatAt,
                      resumes: handedOver ? current.resumes : current.resumes + 1,
                      streamTail: null,
                      handedOverAt: null,
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(claim)
                    .returning()
                    .get(),
                );
                if (run) yield* publish(unit, run.threadId, { run: { to: run.id } });
                return run ? yield* trustedRun(kinds, 'adoptRun', { ...run, streamTail: current.streamTail }) : null;
              }),
            tx,
          ),
        );
      },
      claimSettledForNotification: (input: { heartbeatBefore: Date; now: Date; limit: number; maxAttempts: number }) => {
        const unconfirmed = and(
          isNull(threadRun.settledNotifiedAt),
          inArray(threadRun.status, RUN_ENDINGS),
          lt(threadRun.heartbeatAt, input.heartbeatBefore),
          scope,
        );
        return stored('claimSettledForNotification')(
          units.write(writes('ThreadRunStore.claimSettledForNotification', [runRows]), (unit) =>
            Effect.gen(function* () {
              const claimed = yield* unit.run(
                db
                  .select({
                    id: threadRun.id,
                    threadId: threadRun.threadId,
                    kind: threadRun.kind,
                    status: threadRun.status,
                    failureReason: threadRun.failureReason,
                    failure: threadRun.failure,
                    settledBy: threadRun.settledBy,
                    settledNotification: threadRun.settledNotification,
                    settledNotifyAttempts: threadRun.settledNotifyAttempts,
                  })
                  .from(threadRun)
                  .where(and(unconfirmed, lt(threadRun.settledNotifyAttempts, input.maxAttempts)))
                  .orderBy(asc(threadRun.finishedAt), asc(threadRun.id))
                  .limit(input.limit),
              );
              const spent = yield* unit.run(
                db
                  .select({
                    id: threadRun.id,
                    threadId: threadRun.threadId,
                    settledNotification: threadRun.settledNotification,
                    settledNotifyAttempts: threadRun.settledNotifyAttempts,
                  })
                  .from(threadRun)
                  .where(
                    and(
                      unconfirmed,
                      sql`${threadRun.settledNotifyAttempts} >= ${input.maxAttempts}`,
                      isNotNull(threadRun.settledNotification),
                      sql`json_extract(${threadRun.settledNotification}, '$.exhaustedAt') is null`,
                    ),
                  )
                  .orderBy(asc(threadRun.finishedAt), asc(threadRun.id))
                  .limit(input.limit),
              );
              const exhausted = yield* trusted('claimSettledForNotification', () =>
                spent.map((row) => {
                  const record = parseThreadRunNotification(row.settledNotification);
                  return {
                    id: row.id,
                    threadId: row.threadId,
                    attempts: row.settledNotifyAttempts,
                    record: record === null ? null : { ...record, exhaustedAt: input.now.toISOString() },
                  };
                }),
              );
              for (const row of exhausted) {
                yield* unit.run(
                  db.update(threadRun).set({ settledNotification: row.record, updatedAt: input.now }).where(eq(threadRun.id, row.id)),
                );
              }
              const claims = yield* trusted('claimSettledForNotification', () =>
                claimed.map((row) => ({
                  id: row.id,
                  threadId: row.threadId,
                  kind: row.kind,
                  status: row.status,
                  failureReason: row.failureReason,
                  failure: parseThreadRunFailure(row.failure),
                  settledBy: parseThreadSettledBy(row.settledBy),
                  settledNotification: seedThreadNotification(row.id, input.now, parseThreadRunNotification(row.settledNotification)),
                  attempt: row.settledNotifyAttempts + 1,
                })),
              );
              for (const claim of claims) {
                yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      ownerId,
                      heartbeatAt: input.now,
                      settledNotifyAttempts: sql`${threadRun.settledNotifyAttempts} + 1`,
                      settledNotification: claim.settledNotification,
                      updatedAt: input.now,
                    })
                    .where(and(eq(threadRun.id, claim.id), isNull(threadRun.settledNotifiedAt))),
                );
              }
              return {
                claims,
                exhausted: exhausted.map((row) => ({
                  id: row.id,
                  threadId: row.threadId,
                  attempts: row.attempts,
                  delivered: row.record?.delivered ?? [],
                })),
              };
            }),
          ),
        );
      },
      writeSettledNotification: (runId: string, record: ThreadNotificationRecord, expectedId: string | null) =>
        record.id !== expectedId
          ? Effect.succeed(false)
          : notified('writeSettledNotification', (unit) =>
              unit.run(
                db
                  .update(threadRun)
                  .set({ settledNotification: record, updatedAt: new Date(clock.currentTimeMillisUnsafe()) })
                  .where(notificationClaim(runId, expectedId))
                  .returning({ id: threadRun.id })
                  .all(),
              ),
            ),
      markSettledNotified: (runId: string, notifiedAt: Date, record: ThreadNotificationRecord | null) =>
        notified('markSettledNotified', (unit) =>
          unit.run(
            db
              .update(threadRun)
              .set({
                settledNotifiedAt: notifiedAt,
                settledNotification: record
                  ? { ...record, phase: 'confirmation', subscriber: null, finishedAt: notifiedAt.toISOString() }
                  : null,
                updatedAt: new Date(clock.currentTimeMillisUnsafe()),
              })
              .where(notificationClaim(runId, record?.id ?? null))
              .returning({ id: threadRun.id })
              .all(),
          ),
        ),
      heartbeatSettledClaim: (runId: string, heartbeatAt: Date, expectedId: string | null): Effect.Effect<void, ThreadStorageFailed> =>
        stored('heartbeatSettledClaim')(
          units
            .write(writes('ThreadRunStore.heartbeatSettledClaim', [runRows]), (unit) =>
              unit.run(
                db
                  .update(threadRun)
                  .set({ heartbeatAt, updatedAt: new Date(clock.currentTimeMillisUnsafe()) })
                  .where(notificationClaim(runId, expectedId)),
              ),
            )
            .pipe(Effect.asVoid),
        ),
      redeliverSettled: (runId: string, maxAttempts: number) =>
        notified('redeliverSettled', (unit) =>
          unit.run(
            db
              .update(threadRun)
              .set({
                settledNotifyAttempts: 0,
                settledNotification: sql`case when ${threadRun.settledNotification} is null then null else json_set(${threadRun.settledNotification}, '$.exhaustedAt', json('null')) end`,
                updatedAt: new Date(clock.currentTimeMillisUnsafe()),
              })
              .where(
                and(
                  eq(threadRun.id, runId),
                  ne(threadRun.status, 'running'),
                  isNull(threadRun.settledNotifiedAt),
                  sql`${threadRun.settledNotifyAttempts} >= ${maxAttempts}`,
                  scope,
                ),
              )
              .returning({ id: threadRun.id })
              .all(),
          ),
        ),
    };
  };
});

export function trustedRun(kinds: ThreadEntryReader, call: string, row: ThreadRunRow): Effect.Effect<ThreadRunRow, ThreadStorageFailed> {
  return trusted(call, () => ({
    ...row,
    progress: parseThreadRunProgress(row.progress),
    usage: parseThreadRunUsage(row.usage),
    streamTail: parseThreadStreamTail(kinds, row.streamTail),
    failure: parseThreadRunFailure(row.failure),
    settledBy: parseThreadSettledBy(row.settledBy),
    settledNotification: parseThreadRunNotification(row.settledNotification),
    stopRequest: parseThreadRunStopRequest(row.stopRequest),
    withdrawnWords: parseWithdrawnWords(row.withdrawnWords),
  }));
}
