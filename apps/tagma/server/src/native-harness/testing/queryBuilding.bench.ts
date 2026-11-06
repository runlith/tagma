import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { and, asc, desc, eq, fillPlaceholders, gt, isNull, lte, or, Placeholder, sql, type Param, type Query, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import type { ThreadEventPayloadValue } from '@runlith/agent/thread/storage/eventLog';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { metadataColumns, threadRow } from '../row.js';
import { thread, threadEntry, threadRun } from '../../threads/store/kernel.js';
import { entryField, payloadField } from '../../threads/store/fields.js';
import { bodyInFold } from '../../threads/journal/foldedFacts.js';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import { targetSnapshot, threadLog, threadRev } from '../store/thread.js';
import { mandateFacts } from '../../threads/mandate.js';
import { project } from '../../projects/store/table.js';
import { registration } from '../../projects/resolution.js';
import { journalHead } from '../../threads/journal/base.js';
import { recordFacts, recordsAs } from '../../thread-record/facts.js';
import { factsWhere } from '../../thread-record/identity.js';
import { bindQuery } from '../../platform/store/queries.js';
import { readableField } from '../../platform/store/readableJson.js';
import { storeDb } from '../../platform/contract/service/store.js';
import { setting } from '../../settings/store/table.js';
import { journalProjectOf, threadBase, threadEvent, threadEventIdentity, threadRolloutCursor } from '../../threads/store/journal.js';

const A1_COUNTS = new Map<string, number>([
  ['5a87d6c457198db5', 507],
  ['7fb008158d4c266b', 230],
  ['b7fa629b16478dcc', 362],
  ['96f1d5d272dd2e35', 1803],
  ['1f5e9a94a2387573', 1803],
  ['8c7ed8e99994529b', 2523],
  ['9c1071d8e1460bde', 2572],
  ['a6366da23c94f1ff', 2581],
  ['d129dc8b82f3c6c5', 3379],
  ['8815dd46e05abe18', 1473],
  ['72d6024e4d3538f2', 1478],
  ['56b3b810b05538fc', 2212],
  ['172a0aa7981152a4', 2581],
  ['75c9122508683458', 2581],
  ['e2439998ed20d78b', 2581],
  ['13985ed539e79d6e', 5162],
  ['7a27dcdf707e405e', 1471],
  ['a0c8c6f5ce2939c9', 1471],
  ['a45be3611ee20f37', 1895],
]);

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
  readonly held: Slot<ThreadEventPayloadValue>;
  readonly identity: Slot<string>;
  readonly updatedAt: Slot<Date>;
  readonly reading: Slot<ThreadContextReading>;
  readonly adapter: Slot<string>;
  readonly run: Slot<string>;
  readonly generation: Slot<number>;
  readonly projectId: Slot<number>;
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
  held: { bodyInFold: true, entry: { id: 'entry-10', type: 'tool' } } as unknown as ThreadEventPayloadValue,
  identity: 'tool:run-1:call-10',
  updatedAt: new Date(1_790_000_000_000),
  reading: { tokens: 1024, at: '2026-11-01T00:00:00.000Z' } as unknown as ThreadContextReading,
  adapter: 'native',
  run: 'run-1',
  generation: 3,
  projectId: 7,
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
  held: sql.placeholder('held'),
  identity: sql.placeholder('identity'),
  updatedAt: sql.placeholder('updatedAt'),
  reading: sql.placeholder('reading'),
  adapter: sql.placeholder('adapter'),
  run: sql.placeholder('run'),
  generation: sql.placeholder('generation'),
  projectId: sql.placeholder('projectId'),
};

const encoded = <T>(slot: Slot<T>, column: AnySQLiteColumn): Slot<T> | Param =>
  slot instanceof Placeholder ? sql.param(slot, column) : slot;

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
      const historyGuard = (bind: Bind) =>
        db
          .select({ id: threadLog.threadId })
          .from(threadLog)
          .where(and(eq(threadLog.threadId, bind.id), eq(threadLog.historyThrough, bind.through)));
      const historyCursor = (bind: Bind) =>
        db.update(threadLog).set({ historyThrough: bind.through }).where(eq(threadLog.threadId, bind.id));
      const touched = (bind: Bind) => db.update(thread).set({ updatedAt: bind.updatedAt }).where(eq(thread.id, bind.id));
      const reading = (bind: Bind) =>
        db.update(thread).set({ contextReading: bind.reading, updatedAt: bind.updatedAt }).where(eq(thread.id, bind.id));
      const identityRead = (bind: Bind) =>
        db
          .select({ position: threadEvent.position, payload: threadEvent.payload })
          .from(threadEvent)
          .where(
            and(
              eq(threadEvent.threadId, bind.id),
              lte(threadEvent.position, bind.through),
              sql`${payloadField(threadEvent.payload, 'entry.id')} is not null`,
              sql`${threadEventIdentity(threadEvent.payload)} = ${bind.identity}`,
              bodyInFold(threadEvent.payload),
            ),
          )
          .orderBy(desc(threadEvent.position));
      const restore = (bind: Bind) =>
        db
          .update(threadEvent)
          .set({ payload: bind.payload })
          .where(
            and(
              eq(threadEvent.threadId, bind.id),
              eq(threadEvent.position, bind.position),
              eq(threadEvent.payload, encoded(bind.held, threadEvent.payload)),
            ),
          );
      const adapterGuard = (bind: Bind) =>
        db
          .select({ id: threadRow.id })
          .from(threadRow)
          .where(and(eq(threadRow.id, bind.id), sql`${readableField(threadRow.transport, '$.adapter')} is ${bind.adapter}`));
      const absentGuard = (bind: Bind) => db.select({ id: threadRow.id }).from(threadRow).where(eq(threadRow.id, bind.id));
      const lineage = (column: SQL, label: string) => (bind: Bind) =>
        db.all<{ id: string; depth: number }>(sql`
        with recursive lineage(id, parent, depth) as (
          select tree.id, tree.parent_id, 0 from ${recordsAs('tree')} where tree.id = ${bind.id}
          union all
          select leaf.id, leaf.parent_id, l.depth + 1 from ${recordsAs('leaf')} join lineage l on leaf.id = l.parent
        )
        select l.id as id, ${column} as ${sql.raw(label)}, l.depth as depth
          from lineage l left join ${mandateFacts} on ${mandateFacts.id} = l.id order by l.depth`);
      const delegationLineage = lineage(sql`${mandateFacts.delegation}`, 'delegation');
      const approvesLineage = lineage(sql`${mandateFacts.approves}`, 'approves');
      const teamLineage = lineage(sql`${mandateFacts.team}`, 'team');
      const targetAt = (bind: Bind) =>
        db
          .select()
          .from(targetSnapshot)
          .where(
            and(eq(targetSnapshot.threadId, bind.id), eq(targetSnapshot.runId, bind.run), eq(targetSnapshot.generation, bind.generation)),
          );
      const activeGeneration = (bind: Bind) =>
        db.all<{ run_id: string; generation: unknown }>(sql`
            select r.id as run_id,
                   coalesce(max(case
                     when e.type = 'context-change'
                      and ${entryField(sql.raw('e.entry'), 'status')} = 'published'
                     then ${entryField(sql.raw('e.entry'), 'generation')}
                   end), 0) as generation
              from thread_run r
              left join thread_entry e on e.thread_id = r.thread_id and e.run_id = r.id
             where r.thread_id = ${bind.id} and r.status = 'running'
             group by r.id
          `);
      const projectById = (bind: Bind) =>
        db
          .select(registration)
          .from(project)
          .where(and(eq(project.id, bind.projectId), isNull(project.removedAt)));
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
        {
          name: 'history guard',
          census: '75c9122508683458',
          via: 'program statement',
          direct: () => historyGuard(sample).toSQL(),
          directText: () => historyGuard(sample).toSQL(),
          prepare: () => {
            const query = historyGuard(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'history cursor',
          census: 'e2439998ed20d78b',
          via: 'program statement',
          direct: () => historyCursor(sample).toSQL(),
          directText: () => historyCursor(sample).toSQL(),
          prepare: () => {
            const query = historyCursor(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'thread touched',
          census: '13985ed539e79d6e',
          via: 'program statement',
          direct: () => touched(sample).toSQL(),
          directText: () => touched(sample).toSQL(),
          prepare: () => {
            const query = touched(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'thread touched with context reading',
          census: 'd545b21402fa8905',
          via: 'program statement',
          direct: () => reading(sample).toSQL(),
          directText: () => reading(sample).toSQL(),
          prepare: () => {
            const query = reading(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'folded event identity read',
          census: '7a27dcdf707e405e',
          via: 'effect creation',
          direct: () => identityRead(sample).get(),
          directText: () => identityRead(sample).toSQL(),
          prepare: () => {
            const query = identityRead(holes).prepare();
            return { use: () => query.get(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'folded event restore',
          census: 'a0c8c6f5ce2939c9',
          via: 'program statement',
          direct: () => restore(sample).toSQL(),
          directText: () => restore(sample).toSQL(),
          prepare: () => {
            const query = restore(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'thread row guard, transport adapter',
          census: 'a45be3611ee20f37',
          via: 'program statement',
          direct: () => adapterGuard(sample).toSQL(),
          directText: () => adapterGuard(sample).toSQL(),
          prepare: () => {
            const query = adapterGuard(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'thread row guard, absent row',
          census: '352fe685a755c918',
          via: 'program statement',
          direct: () => absentGuard(sample).toSQL(),
          directText: () => absentGuard(sample).toSQL(),
          prepare: () => {
            const query = absentGuard(holes).prepare();
            return { use: () => bindQuery(query, sample).getQuery(), text: () => bindQuery(query, sample).getQuery() };
          },
        },
        {
          name: 'mandate delegation lineage',
          census: '5a87d6c457198db5',
          via: 'effect creation',
          direct: () => delegationLineage(sample).execute(),
          directText: () => delegationLineage(sample).getQuery(),
          prepare: () => {
            const query = delegationLineage(holes);
            return { use: () => query.execute(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'mandate approves lineage',
          census: '7fb008158d4c266b',
          via: 'effect creation',
          direct: () => approvesLineage(sample).execute(),
          directText: () => approvesLineage(sample).getQuery(),
          prepare: () => {
            const query = approvesLineage(holes);
            return { use: () => query.execute(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'mandate team lineage',
          census: 'b7fa629b16478dcc',
          via: 'effect creation',
          direct: () => teamLineage(sample).execute(),
          directText: () => teamLineage(sample).getQuery(),
          prepare: () => {
            const query = teamLineage(holes);
            return { use: () => query.execute(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'target snapshot at',
          census: '96f1d5d272dd2e35',
          via: 'effect creation',
          direct: () => targetAt(sample).get(),
          directText: () => targetAt(sample).toSQL(),
          prepare: () => {
            const query = targetAt(holes).prepare();
            return { use: () => query.get(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'target snapshot active generation',
          census: '1f5e9a94a2387573',
          via: 'effect creation',
          direct: () => activeGeneration(sample).execute(),
          directText: () => activeGeneration(sample).getQuery(),
          prepare: () => {
            const query = activeGeneration(holes);
            return { use: () => query.execute(sample), text: () => filled(query.getQuery()) };
          },
        },
        {
          name: 'project by id (a section C candidate, not an approved D migration)',
          census: '8c7ed8e99994529b',
          via: 'effect creation',
          direct: () => projectById(sample).get(),
          directText: () => projectById(sample).toSQL(),
          prepare: () => {
            const query = projectById(holes).prepare();
            return { use: () => query.get(sample), text: () => filled(query.getQuery()) };
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
            census: {
              fingerprint: shape.census,
              matches: fingerprint === shape.census,
              a1Statements90s: A1_COUNTS.get(shape.census) ?? null,
            },
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
