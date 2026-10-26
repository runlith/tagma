import { and, count, countDistinct, desc, eq, lt, or, sql } from 'drizzle-orm';
import { Effect, Option, Schema } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Units } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { RefusalActor, type RefusalPlace, type RefusalRow } from '../contract/wire/engines.js';
import { ruleRefusal } from '../store/tables.js';

export const REFUSALS_KEPT = 2000;

export const REFUSAL_DAYS = 90;

const DAY_MS = 86_400_000;

export type Refused = {
  readonly rule: string;
  readonly op: string;
  readonly file: string;
  readonly line: number | null;
  readonly fingerprint: string;
  readonly said: string | null;
  readonly reached: string | null;
  readonly fix: string | null;
  readonly base: string | null;
  readonly branch: string | null;
  readonly actor: RefusalActor | null;
};

export type RefusalPosition = { readonly at: number; readonly id: number };

export type RefusalCount = { readonly times: number; readonly places: number };

export type RefusalRecord = {
  readonly keep: (projectId: number, refused: readonly Refused[], at: Date) => Effect.Effect<void, StoreFailure>;
  readonly places: (
    projectId: number,
    rule: string | null,
    after: RefusalPosition | null,
    limit: number,
  ) => Effect.Effect<readonly RefusalPlace[], StoreFailure>;
  readonly counted: (projectId: number, rule: string | null) => Effect.Effect<RefusalCount, StoreFailure>;
  readonly newest: (projectId: number, rules: readonly string[]) => Effect.Effect<ReadonlyMap<string, RefusalRow>, StoreFailure>;
};

const keeping = writes('enforcement.keepRefusals', [ruleRefusal]);

const actorOf = Schema.decodeUnknownOption(Schema.fromJsonString(RefusalActor));

type Stored = typeof ruleRefusal.$inferSelect;

const rowOf = (row: Stored): RefusalRow => ({
  id: row.id,
  rule: row.rule,
  op: row.op,
  file: row.file,
  line: row.line,
  fingerprint: row.fingerprint,
  said: row.said,
  reached: row.reached,
  fix: row.fix,
  base: row.base,
  branch: row.branch,
  actor: row.actor === null ? null : Option.getOrNull(actorOf(row.actor)),
  at: row.at.toISOString(),
});

export const positionOf = (row: RefusalRow): RefusalPosition => ({ at: Date.parse(row.at), id: row.id });

export const refusalRecord = (db: StoreDb<'machine'>, units: Units<'machine'>): RefusalRecord => {
  const of = (projectId: number, rule: string | null) =>
    rule === null ? eq(ruleRefusal.projectId, projectId) : and(eq(ruleRefusal.projectId, projectId), eq(ruleRefusal.rule, rule));

  return {
    keep: (projectId, refused, at) =>
      refused.length === 0
        ? Effect.void
        : units.write(keeping, (unit) =>
            Effect.gen(function* () {
              yield* unit.run(
                db.insert(ruleRefusal).values(
                  refused.map((one) => ({
                    projectId,
                    rule: one.rule,
                    op: one.op,
                    file: one.file,
                    line: one.line,
                    fingerprint: one.fingerprint,
                    said: one.said,
                    reached: one.reached,
                    fix: one.fix,
                    base: one.base,
                    branch: one.branch,
                    actor: one.actor === null ? null : JSON.stringify(one.actor),
                    at,
                  })),
                ),
              );
              const oldest = new Date(at.getTime() - REFUSAL_DAYS * DAY_MS);
              const kept = sql`(select ${ruleRefusal.id} from ${ruleRefusal} where ${ruleRefusal.projectId} = ${projectId} order by ${ruleRefusal.id} desc limit 1 offset ${REFUSALS_KEPT - 1})`;
              yield* unit.run(
                db
                  .delete(ruleRefusal)
                  .where(and(eq(ruleRefusal.projectId, projectId), or(lt(ruleRefusal.at, oldest), lt(ruleRefusal.id, kept)))),
              );
            }),
          ),
    places: (projectId, rule, after, limit) =>
      units.read((unit) => {
        const ranked = db
          .select({
            id: ruleRefusal.id,
            times: sql<number>`count(*) over (partition by ${ruleRefusal.rule}, ${ruleRefusal.fingerprint})`.as('times'),
            first: sql<number>`min(${ruleRefusal.at}) over (partition by ${ruleRefusal.rule}, ${ruleRefusal.fingerprint})`.as('first'),
            rank: sql<number>`row_number() over (partition by ${ruleRefusal.rule}, ${ruleRefusal.fingerprint} order by ${ruleRefusal.at} desc, ${ruleRefusal.id} desc)`.as(
              'rank',
            ),
          })
          .from(ruleRefusal)
          .where(of(projectId, rule))
          .as('ranked');
        return Effect.map(
          unit.run(
            db
              .select({ row: ruleRefusal, times: ranked.times, first: ranked.first })
              .from(ranked)
              .innerJoin(ruleRefusal, eq(ruleRefusal.id, ranked.id))
              .where(
                and(
                  eq(ranked.rank, 1),
                  after === null
                    ? undefined
                    : or(lt(ruleRefusal.at, new Date(after.at)), and(eq(ruleRefusal.at, new Date(after.at)), lt(ruleRefusal.id, after.id))),
                ),
              )
              .orderBy(desc(ruleRefusal.at), desc(ruleRefusal.id))
              .limit(limit)
              .all(),
          ),
          (rows) =>
            rows.map(({ row, times, first }) => ({ ...rowOf(row), times: Number(times), first: new Date(Number(first)).toISOString() })),
        );
      }),
    counted: (projectId, rule) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ times: count(), places: countDistinct(sql`${ruleRefusal.rule} || ' ' || ${ruleRefusal.fingerprint}`) })
              .from(ruleRefusal)
              .where(of(projectId, rule))
              .get(),
          ),
          (row) => ({ times: row?.times ?? 0, places: row?.places ?? 0 }),
        ),
      ),
    newest: (projectId, rules) =>
      units.read((unit) =>
        Effect.gen(function* () {
          const found = new Map<string, RefusalRow>();
          for (const rule of rules) {
            const row = yield* unit.run(
              db.select().from(ruleRefusal).where(of(projectId, rule)).orderBy(desc(ruleRefusal.at), desc(ruleRefusal.id)).limit(1).get(),
            );
            if (row !== undefined) found.set(rule, rowOf(row));
          }
          return found as ReadonlyMap<string, RefusalRow>;
        }),
      ),
  };
};
