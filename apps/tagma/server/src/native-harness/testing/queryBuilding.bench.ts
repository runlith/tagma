import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { metadataColumns, threadRow } from '../row.js';
import { threadRun } from '../../threads/store/kernel.js';
import { threadRev } from '../store/thread.js';
import { journalHead } from '../../threads/journal/base.js';
import { recordFacts } from '../../thread-record/facts.js';
import { factsWhere } from '../../thread-record/identity.js';
import { storeDb } from '../../platform/contract/service/store.js';
import { setting } from '../../settings/store/table.js';
import { journalProjectOf, threadBase, threadRolloutCursor } from '../../threads/store/journal.js';

const ITERATIONS = 4000;
const WARMUP = 200;

const measured = (build: () => unknown) => {
  let last: unknown;
  for (let n = 0; n < WARMUP; n++) last = build();
  const before = process.threadCpuUsage();
  for (let n = 0; n < ITERATIONS; n++) last = build();
  const cpu = process.threadCpuUsage(before);
  return { cpuUsPerCall: (cpu.user + cpu.system) / ITERATIONS, consumed: last !== undefined };
};

BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* heldPool;
      const connection = yield* Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: () => undefined }, pool));
      const db = yield* makeWithDefaults().pipe(Effect.provide(connection));
      const id = sql.placeholder('id');
      const shapes = [
        {
          name: 'journal facet',
          build: () =>
            db
              .select({
                journal: journalProjectOf(recordFacts.id, recordFacts.projectId),
                evictedAt:
                  sql<Date | null>`(select ${threadRolloutCursor.restedAt} from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${recordFacts.id})`.mapWith(
                    threadRolloutCursor.restedAt,
                  ),
              })
              .from(recordFacts)
              .where(eq(recordFacts.id, id)),
        },
        { name: 'thread metadata', build: () => db.select(metadataColumns).from(threadRow).where(eq(threadRow.id, id)) },
        {
          name: 'thread bases',
          build: () => db.select().from(threadBase).where(eq(threadBase.threadId, id)).orderBy(asc(threadBase.depth)),
        },
        {
          name: 'keyed settings',
          build: () =>
            db
              .select({ scope: setting.scope, key: setting.key, value: setting.value, declined: setting.declined })
              .from(setting)
              .where(
                and(
                  eq(setting.key, sql.placeholder('key')),
                  or(
                    and(eq(setting.scope, 'user'), isNull(setting.projectId)),
                    and(eq(setting.scope, 'project'), eq(setting.projectId, sql.placeholder('projectId'))),
                  ),
                ),
              ),
        },
        { name: 'thread record', build: () => factsWhere(storeDb<'machine'>(db), eq(recordFacts.id, id)) },
        { name: 'run by id', build: () => db.select().from(threadRun).where(eq(threadRun.id, id)) },
        {
          name: 'latest run',
          build: () => db.select().from(threadRun).where(eq(threadRun.threadId, id)).orderBy(desc(threadRun.createdAt), desc(threadRun.id)),
        },
        {
          name: 'thread runs',
          build: () => db.select().from(threadRun).where(eq(threadRun.threadId, id)).orderBy(asc(threadRun.createdAt), asc(threadRun.id)),
        },
        {
          name: 'thread version',
          build: () =>
            db
              .select({
                foldRev: sql<number>`coalesce((select ${threadRev.foldRev} from ${threadRev} where ${threadRev.threadId} = ${id}), 0)`,
                inheritRev: sql<number>`coalesce((select ${threadRev.inheritRev} from ${threadRev} where ${threadRev.threadId} = ${id}), 0)`,
                head: sql<number>`${journalHead(sql`${id}`)}`,
              })
              .from(threadRow)
              .where(eq(threadRow.id, id)),
        },
      ];
      yield* Effect.sync(() => {
        const rows = shapes.map(({ name, build }) => {
          const prepared = build().prepare();
          const fingerprint = pool.statements.query(prepared.getQuery().sql).fingerprint;
          const params = { id: 'thread', key: 'key', projectId: 1 };
          return {
            name,
            fingerprint,
            unprepared: measured(() => build().get(params)),
            prepared: measured(() => prepared.get(params)),
          };
        });
        console.log(
          JSON.stringify(
            {
              iterations: ITERATIONS,
              warmup: WARMUP,
              rows,
              limits:
                'Synchronous query construction and Effect creation only; no SQL or row execution, no per-fingerprint production CPU attribution.',
            },
            null,
            2,
          ),
        );
      });
    }),
  ),
);
