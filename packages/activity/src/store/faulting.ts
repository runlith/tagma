import { readOnly } from '@runlith/sqlite-process/SqliteProcess';
import { sql, type SQL } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Clock, Effect, PubSub, type Semaphore, Stream } from 'effect';
import type { ActivityFaultKind } from '../fault';
import { ActivityFaults } from './faults';
import { lostBetween } from './reading';
import { type ActivityFreshness, ActivityUnreadable } from './record';

const CLEARED = 'faults-cleared';
const HOUR_MS = 60 * 60 * 1000;

type FaultRow = {
  readonly fingerprint: string;
  readonly kind: ActivityFaultKind;
  readonly place: string;
  readonly message: string;
  readonly stack: string | null;
  readonly count: number;
  readonly first_at: number;
  readonly last_at: number;
  readonly activity: string;
  readonly thread: string | null;
  readonly run: string | null;
  readonly project: number | null;
};

const unreadable = (cause: { readonly message: string }) => new ActivityUnreadable({ reason: cause.message });

const groupsSince = (since: number): SQL => sql`occurred as (
    select n.id, n.activity, n.at, n.body, n.body ->> '$.fingerprint' as fingerprint from note n
    where json_extract(body, '$.type') in ('defect', 'degraded') and n.at > ${since}
  ), grouped as (
    select o.*, count(*) over held as count, min(o.at) over held as first_at,
      row_number() over (partition by o.fingerprint order by o.at desc, o.id desc) as newest
    from occurred o window held as (partition by o.fingerprint)
  ), latest as (select * from grouped where newest = 1)`;

export function activityFaults(
  db: EffectSQLiteBunDatabase,
  fresh: Effect.Effect<ActivityFreshness>,
  hours: () => number,
  lane: Semaphore.Semaphore,
  moved: PubSub.PubSub<void>,
): ActivityFaults['Service'] {
  return ActivityFaults.of({
    read: Effect.fn('ActivityFaults.read')(function* ({ limit, after }) {
      const freshness = yield* fresh;
      const now = yield* Clock.currentTimeMillis;
      const [cleared] = yield* readOnly(db.all<{ readonly at: number }>(sql`select at from mark where name = ${CLEARED}`)).pipe(
        Effect.mapError(unreadable),
      );
      const since = Math.max(now - hours() * HOUR_MS, cleared?.at ?? 0);
      const taken = Math.max(1, limit);
      const rows = yield* readOnly(
        db.all<FaultRow>(sql`with ${groupsSince(since)}
          select g.fingerprint, g.body ->> '$.type' as kind, g.body ->> '$.place' as place, g.body ->> '$.message' as message,
            g.body ->> '$.stack' as stack, g.count, g.first_at, g.at as last_at, g.activity, a.thread, a.run, a.project
          from latest g left join activity a on a.id = g.activity
          where ${after === undefined ? sql`1` : sql`(g.at < ${after.lastAt} or (g.at = ${after.lastAt} and g.fingerprint > ${after.fingerprint}))`}
          order by g.at desc, g.fingerprint asc limit ${taken + 1}`),
      ).pipe(Effect.mapError(unreadable));
      const [counted] = yield* readOnly(
        db.all<{ readonly total: number }>(sql`with ${groupsSince(since)} select count(*) as total from latest`),
      ).pipe(Effect.mapError(unreadable));
      const shown = rows.slice(0, taken);
      const last = shown.at(-1);
      return {
        faults: shown.map((row) => ({
          fingerprint: row.fingerprint,
          kind: row.kind,
          place: row.place,
          message: row.message,
          stack: row.stack,
          count: row.count,
          firstAt: row.first_at,
          lastAt: row.last_at,
          activity: row.activity,
          thread: row.thread,
          run: row.run,
          project: row.project,
        })),
        total: counted?.total ?? 0,
        since,
        next: rows.length > taken && last !== undefined ? { lastAt: last.last_at, fingerprint: last.fingerprint } : null,
        lost: yield* lostBetween(db, freshness, since, now),
      };
    }, lane.withPermit),
    clear: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* db
        .run(sql`insert into mark (name, at) values (${CLEARED}, ${now}) on conflict (name) do update set at = excluded.at`)
        .pipe(Effect.mapError(unreadable), lane.withPermit);
      yield* PubSub.publish(moved, undefined);
    }).pipe(Effect.withSpan('ActivityFaults.clear')),
    changes: Stream.fromPubSub(moved),
  });
}

export function faultsAging(
  db: EffectSQLiteBunDatabase,
  hours: () => number,
  lane: Semaphore.Semaphore,
  moved: PubSub.PubSub<void>,
  startedAt: number,
): (now: number) => Effect.Effect<void, ActivityUnreadable> {
  let passed = startedAt - hours() * HOUR_MS;
  return Effect.fn('ActivityFaults.aging')(function* (now: number) {
    const cutoff = now - hours() * HOUR_MS;
    const [aged] = yield* readOnly(
      db.all<{ readonly aged: number }>(sql`select exists (select 1 from note
        where json_extract(body, '$.type') in ('defect', 'degraded') and at > ${passed} and at <= ${cutoff}) as aged`),
    ).pipe(Effect.mapError(unreadable), lane.withPermit);
    passed = Math.max(passed, cutoff);
    if (aged?.aged === 1) yield* PubSub.publish(moved, undefined);
  });
}
