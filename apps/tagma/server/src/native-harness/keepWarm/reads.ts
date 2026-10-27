import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import { KEEP_WARM_SIGNAL_TYPE, keepWarmPingOf } from '@runlith/agent/transcript/keepWarm';
import { type SQL, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { threadRun } from '../../threads/store/kernel.js';
import { threadInbox, KEEP_WARM_PING_IDS } from '../../threads/store/tables.js';
import { recordsAs } from '../../thread-record/facts.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';

export type KeepWarmLatest = {
  readonly runId: string;
  readonly status: ThreadRunRow['status'];
  readonly ping: { readonly anchor: string; readonly ping: number; readonly sentAt: number } | null;
};

export type KeepWarmWaiting = {
  readonly parentThreadId: string | null;
  readonly waits: boolean;
  readonly below: readonly string[];
};

export type KeepWarmReads = Effect.Success<typeof makeKeepWarmReads>;

const among = (ids: readonly string[]): SQL =>
  ids.length === 0
    ? sql`(select null where 0)`
    : sql`(${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`;

export const makeKeepWarmReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const standing = (threadId: string): Effect.Effect<KeepWarmWaiting | null, StoreFailure> =>
    units.read((unit) =>
      Effect.gen(function* () {
        const thread = yield* unit.run(
          db.get<{ parentThreadId: string | null }>(sql`
            select t.parent_id as parentThreadId from ${recordsAs('t')} where t.id = ${threadId}`),
        );
        if (thread === undefined) return null;
        const below = yield* unit.run(
          db.all<{ id: string; running: number }>(sql`
            with recursive below(id) as (
              select c.id from ${recordsAs('c')} where c.parent_id = ${threadId}
              union all
              select cc.id from below b cross join ${recordsAs('cc')} on cc.parent_id = b.id
            )
            select b.id as id, exists (
              select 1 from ${threadRun} r where r.thread_id = b.id and r.status = 'running'
            ) as running
              from below b`),
        );
        return {
          parentThreadId: thread.parentThreadId,
          waits: below.some((row) => row.running === 1),
          below: below.map((row) => row.id),
        };
      }),
    );

  const waiting = (owing: readonly string[]): Effect.Effect<readonly string[], StoreFailure> =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db.all<{ id: string }>(sql`
            with recursive above(id) as (
              select t.parent_id from ${threadRun} w
                cross join ${recordsAs('t')} on t.id = w.thread_id
               where w.status = 'running' and t.parent_id is not null
              union
              select o.id from ${recordsAs('o')} where o.id in ${among(owing)}
              union
              select p.parent_id from above a
                cross join ${recordsAs('p')} on p.id = a.id
               where p.parent_id is not null
            )
            select distinct id from above`),
        ),
        (rows) => rows.map((row) => row.id),
      ),
    );

  const latest = (threadId: string): Effect.Effect<KeepWarmLatest | null, StoreFailure> =>
    units.read((unit) =>
      Effect.gen(function* () {
        const run = yield* unit.run(
          db.get<{ id: string; status: ThreadRunRow['status'] }>(sql`
            select id, status from ${threadRun}
             where thread_id = ${threadId}
             order by created_at desc, id desc
             limit 1`),
        );
        if (run === undefined) return null;
        const opened = yield* unit.run(
          db.get<{ id: string; occurredAt: number }>(sql`
            select id, occurred_at as occurredAt from ${threadInbox}
             where delivered_to_run_id = ${run.id} and id like ${KEEP_WARM_PING_IDS}
             limit 1`),
        );
        const ping = opened === undefined ? null : keepWarmPingOf(opened.id);
        return {
          runId: run.id,
          status: run.status,
          ping: ping === null || opened === undefined ? null : { ...ping, sentAt: opened.occurredAt },
        };
      }),
    );

  return { standing, waiting, latest };
});
