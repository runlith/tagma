import { and, desc, eq, sql } from 'drizzle-orm';
import { Effect, type Context } from 'effect';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { TurnAfter, Turns } from '../contract/service/record.js';
import type { TurnPath } from '../contract/wire/changes.js';
import { workspaceChange } from '../store/tables.js';
import { readHolder } from '../store/homes.js';
import { DURABLE_OUTCOME, type RowOutcome } from '../record/outcomes.js';

const RANKS = { writing: 3, held: 2, committed: 1, withdrawn: 0 } as const;

const STATES = ['withdrawn', 'committed', 'held', 'writing'] as const;

const newestOf = (state: 'committed' | 'withdrawn', column: typeof workspaceChange.reason | RowOutcome['commit'], outcome: RowOutcome) =>
  sql<
    string | null
  >`substr(max(case when ${outcome.state} = ${state} and ${column} is not null then printf('%016d%016d', ${workspaceChange.at}, ${workspaceChange}.rowid) || ${column} end), 33)`;

export type JudgedPaths = ReadonlyMap<string, ReadonlySet<string>>;

export const standingTurn = <T extends TurnPath>(turn: T, judged: JudgedPaths): T => {
  const paths = judged.get(turn.checkout);
  return turn.state === 'held' && paths !== undefined && !paths.has(turn.path) ? { ...turn, state: 'cleared' } : turn;
};

export const turnsOf = (
  units: MachineUnits['Service'],
  store: Context.Service.Shape<typeof MachineStore>,
  projectId: number,
  threadId: string,
  limit: number,
  after?: TurnAfter,
  outcome: RowOutcome = DURABLE_OUTCOME,
): Effect.Effect<Turns, StoreFailure> => {
  const at = sql<number>`max(${workspaceChange.at})`;
  const key = sql<string>`coalesce(${workspaceChange.runId}, '') || char(0) || ${workspaceChange.checkout} || char(0) || ${workspaceChange.path}`;
  const rank = sql<number>`max(case ${outcome.state} when 'writing' then ${RANKS.writing} when 'held' then ${RANKS.held} when 'committed' then ${RANKS.committed} else ${RANKS.withdrawn} end)`;
  const of = and(eq(workspaceChange.holderProjectId, projectId), eq(workspaceChange.holder, threadId));
  return readHolder(units, store, threadId, (unit) =>
    Effect.gen(function* () {
      const grouped = store.db
        .select({
          runId: workspaceChange.runId,
          checkout: workspaceChange.checkout,
          path: workspaceChange.path,
          at,
          key,
          rank,
          commit: newestOf('committed', outcome.commit, outcome),
          reason: newestOf('withdrawn', workspaceChange.reason, outcome),
        })
        .from(workspaceChange)
        .leftJoin(outcome.from, outcome.on)
        .where(of)
        .groupBy(workspaceChange.runId, workspaceChange.checkout, workspaceChange.path);
      const page = yield* unit.run(
        (after === undefined ? grouped : grouped.having(sql`${at} < ${after.at} or (${at} = ${after.at} and ${key} > ${after.key})`))
          .orderBy(desc(at), key)
          .limit(limit),
      );
      const counted = yield* unit.run(
        store.db
          .select({
            total: sql<number>`count(distinct coalesce(${workspaceChange.runId}, '') || char(0) || ${workspaceChange.checkout} || char(0) || ${workspaceChange.path})`,
          })
          .from(workspaceChange)
          .where(of),
      );
      return {
        rows: page.map((row) => {
          const state = STATES[Number(row.rank)] ?? 'withdrawn';
          return {
            runId: row.runId,
            checkout: row.checkout,
            path: row.path,
            at: Number(row.at),
            state,
            commit: state === 'committed' ? row.commit : null,
            reason: state === 'withdrawn' ? row.reason : null,
            key: row.key,
          };
        }),
        total: Number(counted[0]?.total ?? 0),
      };
    }),
  );
};
