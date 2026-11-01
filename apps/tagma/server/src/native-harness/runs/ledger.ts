import { Clock, Effect } from 'effect';
import type { ThreadTranscript } from '@runlith/agent/transcript/rows';
import { sumUsage } from '@runlith/llm/schema/events';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadRunStage } from '@runlith/agent/thread/rows';
import {
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  ThreadRunConflictError,
  ThreadRunKeyReusedError,
  type ThreadRunStorage,
  type ThreadRunHeartbeat,
  type ThreadRunPhase,
  type ThreadRunStopAsked,
} from '@runlith/agent/thread/storage/runs';
import {
  parseThreadRunProgress,
  parseThreadRunStopRequest,
  parseThreadRunUsage,
  type ThreadStorageFailed,
} from '@runlith/agent/thread/persisted';
import { mergedStopRequest, seedThreadNotification } from '@runlith/agent/thread/storage/settlement';
import { and, asc, desc, eq, inArray, type Placeholder, type SQL, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { type WriteSet, writes } from '../../platform/contract/service/writes.js';
import { among } from '../../platform/store/rows.js';
import { thread, threadRun, threadRunTally } from '../../threads/store/kernel.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadLiveSpell } from '../../threads/store/mandate.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { recordFacts } from '../../thread-record/facts.js';
import { stored, type StoredFailure } from '../../platform/store/crossing.js';
import { programOf } from '../../platform/store/programs.js';
import { bindQuery } from '../../platform/store/queries.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { makeEndedRuns } from './endedRuns.js';
import { makeReaping, staged, trustedRun, type RunLifecycle } from './reaping.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

export type ThreadRunStore = ThreadRunStorage<Unit<'machine'>, WriteUnit<'machine'>> & {
  readonly owns: (threadId: string, runId: string) => Effect.Effect<boolean, ThreadStorageFailed>;
};

export type RunsInput = {
  readonly ownerId: string;
  readonly scope: SQL;
  readonly lifecycle?: RunLifecycle;
};

const settling = [threadRun, threadRunTally, threadRecord, threadLiveSpell];

export const makeRunStores = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const kinds = yield* ThreadEntryKinds;
  const clock = yield* Clock.Clock;
  const endedIn = yield* makeEndedRuns;
  const reapingOf = yield* makeReaping;
  const newest = (rows: SQL) => db.select().from(threadRun).where(rows).orderBy(desc(threadRun.createdAt), desc(threadRun.id));
  const heldNewest = (id: string | Placeholder, rows: SQL, held: string | null | Placeholder) =>
    db
      .select({ id: threadRecord.id })
      .from(threadRecord)
      .where(
        and(
          eq(threadRecord.id, id),
          sql`(select ${threadRun.id} || char(0) || coalesce(${threadRun.ownerId}, '') || char(0) || ${threadRun.status} from ${threadRun} where ${rows} order by ${threadRun.createdAt} desc, ${threadRun.id} desc limit 1) is ${held}`,
        ),
      );
  const forThread = sql.placeholder('threadId');
  const runningRows = and(eq(threadRun.threadId, forThread), eq(threadRun.status, 'running')) as SQL;
  const latestByThread = newest(eq(threadRun.threadId, forThread)).prepare();
  const latestRunning = newest(runningRows).prepare();
  const heldRunning = heldNewest(forThread, runningRows, sql.placeholder('held')).prepare();
  const runsByThread = db
    .select()
    .from(threadRun)
    .where(eq(threadRun.threadId, sql.placeholder('threadId')))
    .orderBy(asc(threadRun.createdAt), asc(threadRun.id))
    .prepare();

  const writing = <A, E>(set: WriteSet, work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>, tx?: WriteUnit<'machine'>) =>
    tx ? work(tx) : units.write(set, work);

  const reading = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, StoredFailure>, tx?: Unit<'machine'>) =>
    tx ? work(tx) : units.read(work);

  return ({ ownerId, scope, lifecycle }: RunsInput): ThreadRunStore => {
    const ended = endedIn(scope);
    const reaping = reapingOf({ ownerId, scope, lifecycle, ended, publish: records.publishStatus });
    const ownedRows = (rows: SQL): SQL => and(rows, eq(threadRun.status, 'running'), eq(threadRun.ownerId, ownerId)) as SQL;
    const owned = (runId: string): SQL => ownedRows(eq(threadRun.id, runId));

    const patchRunning = (
      call: string,
      runId: string,
      patch: { progress?: SQL; streamTail?: ThreadTranscript | null; resumes?: number; heartbeatAt: Date },
      tx?: WriteUnit<'machine'>,
    ) =>
      stored(call)(
        writing(
          writes('ThreadRunStore.patchRunning', [threadRun]),
          (unit) =>
            Effect.asVoid(
              unit.run(
                db
                  .update(threadRun)
                  .set({ ...patch, updatedAt: patch.heartbeatAt })
                  .where(owned(runId)),
              ),
            ),
          tx,
        ),
      );

    return {
      ownerId,
      runById: ended.byId,
      runByStartKey: ended.byStartKey,
      settledRuns: ended.page,
      newestSettled: ended.newest,
      reapableRuns: reaping.reapableRuns,
      reapRun: reaping.reapRun,
      handOverRuns: reaping.handOverRuns,
      cutRun: reaping.cutRun,
      adoptRun: reaping.adoptRun,
      claimSettledForNotification: reaping.claimSettledForNotification,
      writeSettledNotification: reaping.writeSettledNotification,
      markSettledNotified: reaping.markSettledNotified,
      heartbeatSettledClaim: reaping.heartbeatSettledClaim,
      redeliverSettled: reaping.redeliverSettled,
      createRun: ({ startFrom, kind, approval, progress, startKey, runId, origin }, tx) =>
        failedAs(
          'createRun',
          writing(
            writes('ThreadRunStore.createRun', [threadRun, thread, threadRecord, threadLiveSpell]),
            (unit) =>
              Effect.gen(function* () {
                const row = yield* unit.run(db.select({ id: thread.id }).from(thread).where(eq(thread.id, startFrom.id)).get());
                if (!row) return yield* Effect.fail(new ThreadNotFoundError(startFrom.id));
                if (startKey !== undefined) {
                  const keyed = yield* ended.byStartKey(startFrom.id, startKey.key, unit);
                  if (keyed !== null) {
                    const standing = yield* unit.run(
                      db.select({ digest: threadRun.startDigest }).from(threadRun).where(eq(threadRun.id, keyed.id)).get(),
                    );
                    const digest = standing?.digest ?? null;
                    if (digest !== null && digest !== startKey.digest) {
                      return yield* Effect.fail(new ThreadRunKeyReusedError({ threadId: startFrom.id, runId: keyed.id }));
                    }
                    return { _tag: 'Replayed', run: keyed } as const;
                  }
                }
                const active = yield* unit.run(
                  db
                    .select({ id: threadRun.id })
                    .from(threadRun)
                    .where(and(eq(threadRun.threadId, startFrom.id), eq(threadRun.status, 'running')))
                    .get(),
                );
                if (active) {
                  return yield* Effect.fail(new ThreadRunConflictError({ threadId: startFrom.id, runId: active.id }));
                }
                const now = new Date(yield* Clock.currentTimeMillis);
                const created = yield* unit.run(
                  db
                    .insert(threadRun)
                    .values({
                      id: runId,
                      threadId: startFrom.id,
                      kind,
                      origin,
                      ownerId,
                      account: startFrom.account,
                      provider: startFrom.provider,
                      model: startFrom.model,
                      reasoning: startFrom.reasoning,
                      switches: startFrom.switches,
                      approvalMode: approval.mode,
                      interactive: approval.interactive,
                      progress,
                      startKey: startKey?.key,
                      startDigest: startKey?.digest,
                      createdAt: now,
                      startedAt: now,
                      heartbeatAt: now,
                      updatedAt: now,
                    })
                    .returning()
                    .get(),
                );
                if (!created) return yield* Effect.die(new Error('Thread run insert returned no row.'));
                yield* records.publishStatus(unit, startFrom.id, { status: 'running', run: { to: created.id } });
                yield* unit.run(
                  db
                    .update(thread)
                    .set({ failureReason: null, updatedAt: new Date(yield* Clock.currentTimeMillis) })
                    .where(eq(thread.id, startFrom.id)),
                );
                if (lifecycle) yield* lifecycle.started(created.threadId, created.startedAt, unit);
                return { _tag: 'Started', run: yield* trustedRun(kinds, 'createRun', created) } as const;
              }),
            tx,
          ),
        ),
      resumeAwaitingRun: ({ threadId, runId, progress, heartbeatAt }) =>
        failedAs(
          'resumeAwaitingRun',
          units.write(writes('ThreadRunStore.resumeAwaitingRun', [threadRun]), (unit) =>
            Effect.gen(function* () {
              const run = yield* unit.run(
                db
                  .select({ progress: threadRun.progress, stopRequest: threadRun.stopRequest })
                  .from(threadRun)
                  .where(and(eq(threadRun.id, runId), eq(threadRun.threadId, threadId), eq(threadRun.status, 'running')))
                  .get(),
              );
              if (!run || run.progress.stage !== THREAD_RUN_AWAITING_QUESTION_STAGE) {
                return yield* Effect.fail(new ThreadRunConflictError({ threadId, runId }));
              }
              if (run.stopRequest !== null) return 'stopping' as const;
              yield* unit.run(
                db
                  .update(threadRun)
                  .set({
                    ownerId,
                    progress: staged(progress),
                    heartbeatAt,
                    handedOverAt: null,
                    updatedAt: new Date(yield* Clock.currentTimeMillis),
                  })
                  .where(and(eq(threadRun.id, runId), eq(threadRun.status, 'running'))),
              );
              return 'resumed' as const;
            }),
          ),
        ),
      parkRun: (runId, progress, heartbeatAt, tx) =>
        stored('parkRun')(
          writing(
            writes('ThreadRunStore.parkRun', [threadRun]),
            (unit) =>
              Effect.gen(function* () {
                const run = yield* unit.run(db.select({ stopRequest: threadRun.stopRequest }).from(threadRun).where(owned(runId)).get());
                if (!run) return 'gone' as const;
                if (run.stopRequest !== null) return 'stopping' as const;
                yield* unit.run(
                  db
                    .update(threadRun)
                    .set({ progress: staged(progress), heartbeatAt, updatedAt: new Date(yield* Clock.currentTimeMillis) })
                    .where(owned(runId)),
                );
                return 'parked' as const;
              }),
            tx,
          ),
        ),
      settleRun: (runId, patch, tx) =>
        stored('settleRun')(
          writing(
            writes('ThreadRunStore.settleRun', settling),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(db.select({ streamTail: threadRun.streamTail }).from(threadRun).where(owned(runId)).get());
                if (!current) return null;
                const run = yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      ...patch,
                      settledBy: patch.settledBy ?? null,
                      settledNotification: seedThreadNotification(runId, patch.finishedAt, null),
                      streamTail: null,
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(owned(runId))
                    .returning()
                    .get(),
                );
                if (!run) return null;
                return yield* reaping.ending(unit, 'settleRun', run, current.streamTail);
              }),
            tx,
          ),
        ),
      stopRun: (runId, patch, tx) => {
        const claim = and(eq(threadRun.id, runId), eq(threadRun.status, 'running'), scope);
        return stored('stopRun')(
          writing(
            writes('ThreadRunStore.stopRun', settling),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(
                  db.select({ streamTail: threadRun.streamTail, stopRequest: threadRun.stopRequest }).from(threadRun).where(claim).get(),
                );
                if (!current) return null;
                const request = mergedStopRequest(parseThreadRunStopRequest(current.stopRequest), patch.intent, patch.finishedAt);
                const run = yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      status: 'aborted',
                      ownerId,
                      failureReason: null,
                      failure: null,
                      progress: patch.progress,
                      finishedAt: patch.finishedAt,
                      settledBy: request.by,
                      stopRequest: request,
                      settledNotification: seedThreadNotification(runId, patch.finishedAt, null),
                      heartbeatAt: patch.heartbeatAt,
                      streamTail: null,
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(claim)
                    .returning()
                    .get(),
                );
                if (!run) return null;
                return yield* reaping.ending(unit, 'stopRun', run, current.streamTail);
              }),
            tx,
          ),
        );
      },
      withdrawRun: (runId, words, tx) =>
        stored('withdrawRun')(
          writing(
            writes('ThreadRunStore.withdrawRun', [threadRun]),
            (unit) =>
              Effect.flatMap(
                unit.run(
                  db
                    .update(threadRun)
                    .set({ status: 'withdrawn', withdrawnWords: words, updatedAt: new Date(clock.currentTimeMillisUnsafe()) })
                    .where(and(eq(threadRun.id, runId), eq(threadRun.status, 'aborted'), scope))
                    .returning()
                    .get(),
                ),
                (run) => (run ? trustedRun(kinds, 'withdrawRun', run) : Effect.succeed(null)),
              ),
            tx,
          ),
        ),
      markStatus: ({ threadId, status, failureReason, updatedAt }, tx) =>
        stored('markStatus')(
          writing(
            writes('ThreadRunStore.markStatus', [thread, threadRecord]),
            (unit) =>
              Effect.gen(function* () {
                if (status !== 'running') {
                  const running = and(eq(threadRun.threadId, threadId), eq(threadRun.status, 'running'));
                  if (yield* unit.run(db.select({ id: threadRun.id }).from(threadRun).where(running).get())) return;
                }
                yield* records.publishStatus(unit, threadId, { status });
                yield* unit.run(db.update(thread).set({ failureReason, updatedAt }).where(eq(thread.id, threadId)));
              }),
            tx,
          ),
        ),
      latestRun: (threadId, statuses, tx) => {
        const running = statuses?.length === 1 && statuses[0] === 'running';
        const rowsOf = (): SQL =>
          statuses === undefined
            ? eq(threadRun.threadId, threadId)
            : (and(eq(threadRun.threadId, threadId), inArray(threadRun.status, [...statuses])) as SQL);
        const latest = (unit: Unit<'machine'>) =>
          Effect.flatMap(
            unit.run(
              running
                ? latestRunning.get({ threadId })
                : statuses === undefined
                  ? latestByThread.get({ threadId })
                  : newest(rowsOf()).get(),
            ),
            (row) => (row ? trustedRun(kinds, 'latestRun', row) : Effect.succeed(null)),
          );
        const program = tx === undefined ? null : programOf(tx);
        if (program === null) return stored('latestRun')(reading(latest, tx));
        return stored('latestRun')(
          Effect.tap(units.read(latest), (run) => {
            const held = run === null ? null : `${run.id}\u0000${run.ownerId ?? ''}\u0000${run.status}`;
            return program.guard(running ? bindQuery(heldRunning, { threadId, held }) : heldNewest(threadId, rowsOf(), held), 1);
          }),
        );
      },
      latestRuns: (threadIds, tx) =>
        threadIds.length === 0
          ? Effect.succeed([])
          : stored('latestRuns')(
              reading(
                (unit) =>
                  Effect.flatMap(
                    unit.run(
                      db
                        .select()
                        .from(threadRun)
                        .where(
                          and(
                            inArray(threadRun.threadId, among(threadIds)),
                            sql`${threadRun.id} = (select newest.id from ${threadRun} as newest where newest.thread_id = ${threadRun.threadId} order by newest.created_at desc, newest.id desc limit 1)`,
                          ),
                        ),
                    ),
                    (rows) => Effect.all(rows.map((row) => trustedRun(kinds, 'latestRuns', row))),
                  ),
                tx,
              ),
            ),
      owns: (threadId, runId) =>
        stored('owns')(
          units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ id: threadRun.id })
                  .from(threadRun)
                  .where(and(eq(threadRun.id, runId), eq(threadRun.threadId, threadId)))
                  .get(),
              ),
              (row) => row !== undefined,
            ),
          ),
        ),
      runsOf: (threadId, tx) =>
        stored('runsOf')(
          reading(
            (unit) =>
              Effect.flatMap(unit.run(runsByThread.all({ threadId })), (rows) =>
                Effect.all(rows.map((row) => trustedRun(kinds, 'runsOf', row))),
              ),
            tx,
          ),
        ),
      runningOf: (threadIds, tx) =>
        threadIds.length === 0
          ? Effect.succeed([])
          : stored('runningOf')(
              reading(
                (unit) =>
                  Effect.flatMap(
                    unit.run(
                      db
                        .select()
                        .from(threadRun)
                        .where(and(eq(threadRun.status, 'running'), inArray(threadRun.threadId, among(threadIds)))),
                    ),
                    (rows) => Effect.all(rows.map((row) => trustedRun(kinds, 'runningOf', row))),
                  ),
                tx,
              ),
            ),
      spentBySpawnRoot: (spawnRootId, owner, tx) =>
        stored('spentBySpawnRoot')(
          reading(
            (unit) =>
              Effect.map(
                unit.run(
                  db
                    .select({ spent: sql<number>`coalesce(sum(json_extract(${threadRun.usage}, '$.totalTokens')), 0)` })
                    .from(threadRun)
                    .innerJoin(recordFacts, eq(recordFacts.id, threadRun.threadId))
                    .where(and(eq(recordFacts.spawnRootId, spawnRootId), eq(recordFacts.principalId, owner)))
                    .get(),
                ),
                (row) => row?.spent ?? 0,
              ),
            tx,
          ),
        ),
      isRunning: (runId) =>
        stored('isRunning')(
          units.read((unit) =>
            Effect.map(unit.run(db.select({ id: threadRun.id }).from(threadRun).where(owned(runId)).get()), (row) => Boolean(row)),
          ),
        ),
      runningHere: (runIds) =>
        stored('runningHere')(
          units.read((unit) =>
            runIds.length === 0
              ? Effect.succeed<readonly string[]>([])
              : Effect.map(
                  unit.run(
                    db
                      .select({ id: threadRun.id })
                      .from(threadRun)
                      .where(ownedRows(inArray(threadRun.id, [...runIds])))
                      .all(),
                  ),
                  (rows) => rows.map((row) => row.id),
                ),
          ),
        ),
      writeProgress: (runId, progress, heartbeatAt, tx, durable = false) =>
        patchRunning('writeProgress', runId, { progress: staged(progress), resumes: durable ? 0 : undefined, heartbeatAt }, tx),
      writePhase: (runId, phase, tx) =>
        stored('writePhase')(
          writing(
            writes('ThreadRunStore.writePhase', [threadRun]),
            (unit) =>
              Effect.gen(function* () {
                const statement = db
                  .update(threadRun)
                  .set({
                    progress:
                      phase === null
                        ? sql`json_remove(${threadRun.progress}, '$.phase')`
                        : sql`json_set(${threadRun.progress}, '$.phase', json(${JSON.stringify(phase)}))`,
                    updatedAt: new Date(clock.currentTimeMillisUnsafe()),
                  })
                  .where(owned(runId))
                  .returning({
                    id: threadRun.id,
                    threadId: threadRun.threadId,
                    progress: threadRun.progress,
                    updatedAt: threadRun.updatedAt,
                  });
                const program = programOf(unit);
                if (program === null) return yield* unit.run(statement);
                const written: ThreadRunPhase[] = [];
                yield* program.returning(statement, (rows) =>
                  Effect.sync(() => {
                    for (const [id, threadId, progress, updatedAt] of rows) {
                      written.push({
                        id: String(id),
                        threadId: String(threadId),
                        progress: parseThreadRunProgress(threadRun.progress.mapFromDriverValue(String(progress))),
                        updatedAt: threadRun.updatedAt.mapFromDriverValue(Number(updatedAt)),
                      });
                    }
                  }),
                );
                return written;
              }),
            tx,
          ),
        ),
      addUsage: (runId, delta, heartbeatAt, tx) =>
        stored('addUsage')(
          writing(
            writes('ThreadRunStore.addUsage', [threadRun]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(db.select({ usage: threadRun.usage }).from(threadRun).where(owned(runId)).get());
                if (!current) return;
                const held = parseThreadRunUsage(current.usage);
                yield* unit.run(
                  db
                    .update(threadRun)
                    .set({ usage: sumUsage(held, delta), resumes: 0, heartbeatAt, updatedAt: new Date(yield* Clock.currentTimeMillis) })
                    .where(owned(runId)),
                );
              }),
            tx,
          ),
        ),
      charge: (runId, charge, tx) =>
        stored('charge')(
          writing(
            writes('ThreadRunStore.charge', [threadRun]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(db.select({ usage: threadRun.usage }).from(threadRun).where(eq(threadRun.id, runId)).get());
                if (!current) return;
                yield* unit.run(
                  db
                    .update(threadRun)
                    .set({
                      ...(charge.usage === null ? {} : { usage: sumUsage(parseThreadRunUsage(current.usage), charge.usage) }),
                      ...(charge.cost === null ? {} : { cost: charge.cost }),
                      updatedAt: new Date(yield* Clock.currentTimeMillis),
                    })
                    .where(eq(threadRun.id, runId)),
                );
              }),
            tx,
          ),
        ),
      writeHeartbeats: (runIds, heartbeatAt, tx) =>
        runIds.length === 0
          ? Effect.succeed({ written: [], asked: [] })
          : stored('writeHeartbeats')(
              writing(
                writes('ThreadRunStore.writeHeartbeats', [threadRun]),
                (unit) =>
                  Effect.gen(function* () {
                    const statement = db
                      .update(threadRun)
                      .set({ heartbeatAt, updatedAt: heartbeatAt })
                      .where(ownedRows(inArray(threadRun.id, among(runIds))))
                      .returning({
                        id: threadRun.id,
                        threadId: threadRun.threadId,
                        heartbeatAt: threadRun.heartbeatAt,
                        updatedAt: threadRun.updatedAt,
                        stopRequest: threadRun.stopRequest,
                      });
                    const written: ThreadRunHeartbeat[] = [];
                    const asked: ThreadRunStopAsked[] = [];
                    const program = programOf(unit);
                    if (program !== null) {
                      yield* program.returning(statement, (rows) =>
                        Effect.sync(() => {
                          for (const [id, threadId, heartbeat, updated, value] of rows) {
                            const runId = String(id);
                            written.push({
                              id: runId,
                              threadId: String(threadId),
                              heartbeatAt: threadRun.heartbeatAt.mapFromDriverValue(Number(heartbeat)),
                              updatedAt: threadRun.updatedAt.mapFromDriverValue(Number(updated)),
                            });
                            const request = parseThreadRunStopRequest(
                              value === null ? null : threadRun.stopRequest.mapFromDriverValue(String(value)),
                            );
                            if (request !== null) asked.push({ runId, by: request.by });
                          }
                        }),
                      );
                    } else {
                      const beaten = yield* unit.run(statement.all());
                      for (const { stopRequest, ...run } of beaten) {
                        written.push(run);
                        const request = parseThreadRunStopRequest(stopRequest);
                        if (request !== null) asked.push({ runId: run.id, by: request.by });
                      }
                    }
                    return { written, asked };
                  }),
                tx,
              ),
            ),
      requestStop: (runId, intent, at, tx) => {
        const claim = and(eq(threadRun.id, runId), eq(threadRun.status, 'running'), scope);
        return stored('requestStop')(
          writing(
            writes('ThreadRunStore.requestStop', [threadRun]),
            (unit) =>
              Effect.gen(function* () {
                const current = yield* unit.run(db.select({ stopRequest: threadRun.stopRequest }).from(threadRun).where(claim).get());
                if (!current) return null;
                const request = mergedStopRequest(parseThreadRunStopRequest(current.stopRequest), intent, at);
                yield* unit.run(
                  db
                    .update(threadRun)
                    .set({ stopRequest: request, updatedAt: new Date(yield* Clock.currentTimeMillis) })
                    .where(claim),
                );
                return request;
              }),
            tx,
          ),
        );
      },
      writeStreamTail: (runId, tail, heartbeatAt, tx, durable = false) =>
        patchRunning('writeStreamTail', runId, { streamTail: tail, resumes: durable || tail?.length ? 0 : undefined, heartbeatAt }, tx),
    };
  };
});
