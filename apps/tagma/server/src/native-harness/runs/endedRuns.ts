import { Effect } from 'effect';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadSettledPosition } from '@runlith/agent/thread/storage/runs';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { among } from '../../platform/store/rows.js';
import { stored, type StoredFailure } from '../../platform/store/crossing.js';
import { programOf } from '../../platform/store/programs.js';
import { ENDED_RUN, ENDINGS_LIST, threadRun, threadRunTally } from '../../threads/store/kernel.js';
import { trustedRun } from './reaping.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

type Ended = { readonly finishedAt: Date | null; readonly id: string };

export type EndedRuns = ReturnType<Effect.Success<typeof makeEndedRuns>>;

export const makeEndedRuns = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const runById = db
    .select()
    .from(threadRun)
    .where(eq(threadRun.id, sql.placeholder('runId')))
    .prepare();
  const runByKey = db
    .select()
    .from(threadRun)
    .where(and(eq(threadRun.threadId, sql.placeholder('threadId')), eq(threadRun.startKey, sql.placeholder('key'))))
    .prepare();

  const byNewest = (left: Ended, right: Ended) =>
    (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0) || right.id.localeCompare(left.id);

  const runWhere = (call: string, where: SQL | undefined, query: ReturnType<typeof runById.get>, tx?: Unit<'machine'>) => {
    const work = (unit: Unit<'machine'>): Effect.Effect<ThreadRunRow | null, StoredFailure> =>
      Effect.flatMap(unit.run(query), (row) => (row ? trustedRun(kinds, call, row) : Effect.succeed(null)));
    const program = tx === undefined ? null : programOf(tx);
    if (program === null) return stored(call)(tx ? work(tx) : units.read(work));
    return stored(call)(
      Effect.tap(units.read(work), (row) =>
        row === null
          ? program.guard(db.select({ id: threadRun.id }).from(threadRun).where(where), 0)
          : program.guard(
              db
                .select({ id: threadRun.id })
                .from(threadRun)
                .where(and(eq(threadRun.id, row.id), eq(threadRun.status, row.status), sql`${threadRun.ownerId} is ${row.ownerId}`)),
              1,
            ),
      ),
    );
  };

  return (scope: SQL) => {
    const inScope = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadIds: readonly string[]) {
      if (threadIds.length === 0) return [];
      const tallies = yield* unit.run(
        db
          .select()
          .from(threadRunTally)
          .where(inArray(threadRunTally.threadId, among(threadIds))),
      );
      if (tallies.length === 0) return [];
      const scoped = yield* unit.run(
        db
          .select({ id: threadRun.id })
          .from(threadRun)
          .where(and(inArray(threadRun.id, among(tallies.map((tally) => tally.latestRunId))), scope)),
      );
      const held = new Set(scoped.map((row) => row.id));
      return tallies.filter((tally) => held.has(tally.latestRunId));
    });

    return {
      tally: (unit: WriteUnit<'machine'>, ended: { readonly id: string; readonly threadId: string; readonly finishedAt: Date | null }) =>
        unit.run(
          db
            .insert(threadRunTally)
            .values({
              threadId: ended.threadId,
              endedRuns: 1,
              latestRunId: ended.id,
              latestFinishedAt: ended.finishedAt ?? new Date(),
              unseen: true,
            })
            .onConflictDoUpdate({
              target: threadRunTally.threadId,
              set: {
                unseen: true,
                endedRuns: sql`${threadRunTally.endedRuns} + 1`,
                latestRunId: sql`case when (excluded.latest_finished_at, excluded.latest_run_id) > (${threadRunTally.latestFinishedAt}, ${threadRunTally.latestRunId}) then excluded.latest_run_id else ${threadRunTally.latestRunId} end`,
                latestFinishedAt: sql`max(excluded.latest_finished_at, ${threadRunTally.latestFinishedAt})`,
              },
            }),
        ),
      byId: (runId: string, tx?: Unit<'machine'>) => runWhere('runById', eq(threadRun.id, runId), runById.get({ runId }), tx),
      byStartKey: (threadId: string, key: string, tx?: Unit<'machine'>) =>
        runWhere('runByStartKey', and(eq(threadRun.threadId, threadId), eq(threadRun.startKey, key)), runByKey.get({ threadId, key }), tx),
      page: (input: { threadIds: readonly string[]; limit: number; after?: ThreadSettledPosition }) => {
        const threadIds = [...new Set(input.threadIds)];
        const after = input.after;
        const older =
          after === undefined
            ? undefined
            : sql`(${threadRun.finishedAt}, ${threadRun.id}) < (${sql.param(after.finishedAt, threadRun.finishedAt)}, ${after.id})`;
        return stored('settledRuns')(
          units.read((unit) =>
            Effect.gen(function* () {
              const tallies = yield* inScope(unit, threadIds);
              const pages = yield* Effect.forEach(tallies, (tally) =>
                unit.run(
                  db
                    .select()
                    .from(threadRun)
                    .where(and(eq(threadRun.threadId, tally.threadId), ENDED_RUN, older))
                    .orderBy(desc(threadRun.finishedAt), desc(threadRun.id))
                    .limit(input.limit),
                ),
              );
              const rows = pages.flat().sort(byNewest).slice(0, input.limit);
              return {
                rows: yield* Effect.forEach(rows, (row) => trustedRun(kinds, 'settledRuns', row)),
                total: tallies.reduce((sum, tally) => sum + tally.endedRuns, 0),
              };
            }),
          ),
        );
      },
      newest: (
        threadIds: readonly string[],
        depth: number,
        tx?: Unit<'machine'>,
      ): Effect.Effect<readonly ThreadRunRow[], ThreadStorageFailed> => {
        if (threadIds.length === 0) return Effect.succeed([]);
        const x = alias(threadRun, 'newest_run');
        const ids = sql`(select ${threadRun.id} from json_each(${JSON.stringify([...new Set(threadIds)])}) want
          join ${threadRun} on ${threadRun.id} in (
            select ${x.id} from ${threadRun} as "newest_run" where ${x.threadId} = want.value and ${x.status} in ${ENDINGS_LIST}
            order by ${x.finishedAt} desc, ${x.id} desc limit ${depth}))`;
        const read = (unit: Unit<'machine'>) =>
          Effect.flatMap(
            unit.run(
              db
                .select()
                .from(threadRun)
                .where(and(inArray(threadRun.id, ids), scope)),
            ),
            (rows) => Effect.forEach(rows.sort(byNewest), (row) => trustedRun(kinds, 'newestSettled', row)),
          );
        return stored('newestSettled')(tx === undefined ? units.read(read) : read(tx));
      },
    };
  };
});
