import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { and, asc, desc, eq, fillPlaceholders, gt, isNull, or, sql, type Placeholder, type Query } from 'drizzle-orm';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { metadataColumns, threadRow } from '../row.js';
import { threadEntry, threadRun } from '../../threads/store/kernel.js';
import { threadLog, threadRev } from '../store/thread.js';
import { journalHead } from '../../threads/journal/base.js';
import { recordFacts } from '../../thread-record/facts.js';
import { factsWhere } from '../../thread-record/identity.js';
import { bindQuery } from '../../platform/store/queries.js';
import { storeDb } from '../../platform/contract/service/store.js';
import { setting } from '../../settings/store/table.js';
import { journalProjectOf, threadBase, threadEvent, threadRolloutCursor } from '../../threads/store/journal.js';

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

type Slot<T> = T | Placeholder;

type Bind = {
  readonly id: Slot<string>;
  readonly through: Slot<number>;
  readonly low: Slot<number>;
  readonly high: Slot<number>;
  readonly ord: Slot<number>;
  readonly entryId: Slot<string>;
  readonly runId: Slot<string | null>;
  readonly type: Slot<string>;
  readonly position: Slot<number>;
  readonly entry: Slot<ThreadTranscriptEntry>;
  readonly payload: Slot<ThreadEventPayloadValue>;
};

const sample = {
  id: 'thread',
  through: 41,
  low: 0,
  high: 9,
  ord: 10,
  entryId: 'entry-10',
  runId: 'run-1',
  type: 'message',
  position: 42,
  entry: { id: 'entry-10', type: 'message', role: 'assistant', text: 'x'.repeat(1024) } as unknown as ThreadTranscriptEntry,
  payload: { entry: { id: 'entry-10', type: 'tool', input: 'x'.repeat(1024) } } as unknown as ThreadEventPayloadValue,
} satisfies Bind;

const holes: Bind = {
  id: sql.placeholder('id'),
  through: sql.placeholder('through'),
  low: sql.placeholder('low'),
  high: sql.placeholder('high'),
  ord: sql.placeholder('ord'),
  entryId: sql.placeholder('entryId'),
  runId: sql.placeholder('runId'),
  type: sql.placeholder('type'),
  position: sql.placeholder('position'),
  entry: sql.placeholder('entry'),
  payload: sql.placeholder('payload'),
};

const baseOf = (id: Slot<string>) =>
  sql`exists (select 1 from ${threadBase} where ${threadBase.threadId} = ${id} or ${threadBase.sourceId} = ${id})`;
const lowestOf = (id: Slot<string>) =>
  sql<number>`coalesce((select min(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${id}), 0)`;
const highestOf = (id: Slot<string>) =>
  sql<number>`coalesce((select max(${threadEntry.ord}) from ${threadEntry} where ${threadEntry.threadId} = ${id}), -1)`;

type Planned = {
  readonly name: string;
  readonly census: string;
  readonly via: 'effect creation' | 'program statement';
  readonly direct: () => unknown;
  readonly directText: () => Query;
  readonly prepare: () => { readonly use: () => unknown; readonly text: () => Query };
};

const filled = (compiled: Query): Query => ({ sql: compiled.sql, params: fillPlaceholders(compiled.params, sample) });

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
      const bounds = (bind: Bind) =>
        db.all<{ low: number; high: number; layered: number }>(
          sql`select ${lowestOf(bind.id)} as low, ${highestOf(bind.id)} as high, ${baseOf(bind.id)} as layered`,
        );
      const guard = (bind: Bind) =>
        db
          .select({ id: threadLog.threadId })
          .from(threadLog)
          .where(
            and(
              eq(threadLog.threadId, bind.id),
              eq(threadLog.entriesThrough, bind.through),
              sql`not ${baseOf(bind.id)}`,
              sql`${lowestOf(bind.id)} = ${bind.low}`,
              sql`${highestOf(bind.id)} = ${bind.high}`,
            ),
          );
      const suffix = (bind: Bind) =>
        db
          .select({ kind: threadEvent.kind, payload: threadEvent.payload })
          .from(threadEvent)
          .where(
            and(
              eq(threadEvent.threadId, bind.id),
              gt(
                threadEvent.position,
                sql<number>`coalesce((select ${threadLog.entriesThrough} from ${threadLog} where ${threadLog.threadId} = ${bind.id}), 0)`,
              ),
            ),
          )
          .orderBy(asc(threadEvent.position));
      const insert = (bind: Bind) =>
        db.insert(threadEntry).values({
          threadId: bind.id,
          ord: bind.ord,
          entryId: bind.entryId,
          runId: bind.runId,
          type: bind.type,
          entry: bind.entry,
        });
      const replace = (bind: Bind) =>
        db
          .update(threadEntry)
          .set({ entry: bind.entry, runId: bind.runId, type: bind.type })
          .where(and(eq(threadEntry.threadId, bind.id), eq(threadEntry.entryId, bind.entryId)));
      const folded = (bind: Bind) =>
        db
          .update(threadEvent)
          .set({ payload: bind.payload })
          .where(and(eq(threadEvent.threadId, bind.id), eq(threadEvent.position, bind.position)));
      const cursor = (bind: Bind) => db.update(threadLog).set({ entriesThrough: bind.through }).where(eq(threadLog.threadId, bind.id));
      const planning: readonly Planned[] = [
        {
          name: 'planning bounds',
          census: '9c1071d8e1460bde',
          via: 'effect creation',
          direct: () => bounds(sample).execute(),
          directText: () => bounds(sample).getQuery(),
          prepare: () => {
            const query = bounds(holes);
            return { use: () => query.execute(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'planning guard',
          census: 'a6366da23c94f1ff',
          via: 'program statement',
          direct: () => guard(sample).toSQL(),
          directText: () => guard(sample).toSQL(),
          prepare: () => {
            const query = guard(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'transcript suffix',
          census: 'd129dc8b82f3c6c5',
          via: 'effect creation',
          direct: () => suffix(sample).all(),
          directText: () => suffix(sample).toSQL(),
          prepare: () => {
            const query = suffix(holes).prepare();
            return { use: () => query.all(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'placement insert',
          census: '8815dd46e05abe18',
          via: 'program statement',
          direct: () => insert(sample).toSQL(),
          directText: () => insert(sample).toSQL(),
          prepare: () => {
            const query = insert(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'placement replace',
          census: '72d6024e4d3538f2',
          via: 'program statement',
          direct: () => replace(sample).toSQL(),
          directText: () => replace(sample).toSQL(),
          prepare: () => {
            const query = replace(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'placement folded tool fact',
          census: '56b3b810b05538fc',
          via: 'program statement',
          direct: () => folded(sample).toSQL(),
          directText: () => folded(sample).toSQL(),
          prepare: () => {
            const query = folded(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'placement cursor',
          census: '172a0aa7981152a4',
          via: 'program statement',
          direct: () => cursor(sample).toSQL(),
          directText: () => cursor(sample).toSQL(),
          prepare: () => {
            const query = cursor(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
      ];
      yield* Effect.sync(() => {
        const rows = shapes.map(({ name, build }) => {
          const prepared = build().prepare();
          const fingerprint = pool.statements.query(prepared.getQuery().sql).fingerprint;
          const params = { id: 'thread', key: 'key', projectId: 1 };
          return {
            name,
            via: 'effect creation',
            fingerprint,
            unprepared: measured(() => build().get(params)),
            prepared: measured(() => prepared.get(params)),
          };
        });
        const planned = planning.map((shape) => {
          const prepared = shape.prepare();
          const direct = shape.directText();
          const bound = prepared.text();
          if (direct.sql !== bound.sql || JSON.stringify(direct.params) !== JSON.stringify(bound.params))
            throw new Error(`${shape.name}: the prepared shape binds different SQL or parameters than the unprepared one`);
          const fingerprint = pool.statements.query(bound.sql).fingerprint;
          return {
            name: shape.name,
            via: shape.via,
            fingerprint,
            census: { fingerprint: shape.census, matches: fingerprint === shape.census },
            sameSqlAndParams: true,
            unprepared: measured(shape.direct),
            prepared: measured(prepared.use),
          };
        });
        console.log(
          JSON.stringify(
            {
              iterations: ITERATIONS,
              warmup: WARMUP,
              rows: [...rows, ...planned],
              limits:
                "Synchronous construction only. 'effect creation' rows time building the query and its row mapper and creating the Effect, as a unit read does before it runs; 'program statement' rows time the SQL and encoded parameters a write program collects (toSQL against bindQuery(...).getQuery()). No SQL executes, no rows are mapped, no writer program runs, and there is no per-fingerprint production CPU attribution.",
            },
            null,
            2,
          ),
        );
      });
    }),
  ),
);
