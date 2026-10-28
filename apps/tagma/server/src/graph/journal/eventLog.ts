import { Effect, Layer, type Result } from 'effect';
import { GRAPH_EVENT_OPS, type GraphEventOp, type JournalVocabulary } from '../contract/wire/journal.js';
import { SessionNames } from '../contract/service/orientation.js';
import { journalSessions } from './writers.js';
import { GraphJournal } from '../contract/service/journal.js';
import { type ActEntry } from '../contract/service/acts.js';
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { block, blockTag, event } from '../store/tables.js';
import { session } from '../../platform/store/writers.js';
import { setting } from '../../settings/store/table.js';
import { carriesTag } from '../vocabulary/projection.js';
import { type JournalPayloadUnreadable, readJournal } from '../contract/wire/journalPayloads.js';
import { scopeCondition, subtreeIds } from '../search/selection.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { mirrorRevision } from '../tree/mirror.js';

export type Concerned = { readonly ids: number[]; readonly unreadable: JournalPayloadUnreadable | null };

const withPeers = <A>(
  own: readonly number[],
  read: Result.Result<A, JournalPayloadUnreadable>,
  peers: (payload: A) => readonly number[],
): Concerned =>
  read._tag === 'Success' ? { ids: [...own, ...peers(read.success)], unreadable: null } : { ids: [...own], unreadable: read.failure };

export function blocksOf(row: ActEntry): Concerned {
  if (!GRAPH_EVENT_OPS.includes(row.op)) return { ids: [], unreadable: null };
  const own = row.blockId === null ? [] : [row.blockId];
  switch (row.op) {
    case 'link':
    case 'unlink':
      return withPeers(own, readJournal.link(row), (payload) => (payload.toId === undefined ? [] : [payload.toId]));
    case 'delete':
    case 'restore':
      return withPeers([], readJournal.trash(row), (payload) => payload.ids);
    case 'settle':
      return withPeers(own, readJournal.settle(row), (payload) => payload.settled);
    case 'answer':
    case 'unanswer':
      return withPeers(own, readJournal.answer(row), (payload) => (payload.by === undefined ? [] : [payload.by]));
    case 'supersede':
    case 'unsupersede':
      return withPeers(own, readJournal.supersede(row), (payload) => [payload.withId]);
    case 'project_set_storage':
    case 'project_remove':
    case 'project_return':
      return { ids: [], unreadable: null };
    case 'project_add':
    case 'project_set_root':
    case 'project_set':
    case 'create':
    case 'update':
    case 'claim':
    case 'release':
    case 'done':
    case 'close':
    case 'anchor':
    case 'unanchor':
    case 'relocate':
    case 'enable':
    case 'disable':
    case 'enforce':
    case 'remeasure':
      return { ids: own, unreadable: null };
  }
}

const PEER_PATHS = {
  link: { path: '$.toId', many: false },
  unlink: { path: '$.toId', many: false },
  supersede: { path: '$.withId', many: false },
  unsupersede: { path: '$.withId', many: false },
  answer: { path: '$.by', many: false },
  unanswer: { path: '$.by', many: false },
  settle: { path: '$.settled', many: true },
  delete: { path: '$.ids', many: true },
  restore: { path: '$.ids', many: true },
} as const satisfies Partial<Record<GraphEventOp, { readonly path: string; readonly many: boolean }>>;

const PEER_OPS = Object.keys(PEER_PATHS) as GraphEventOp[];

function concerningIds(scopeId: number, within: SQL | undefined): SQL {
  const window = within === undefined ? sql`1` : within;
  const payload = sql`(case when json_valid(${event.payload}) then ${event.payload} else '{}' end)`;
  const peers = sql.join(
    Object.entries(PEER_PATHS).map(([op, { path, many }]) =>
      many
        ? sql`(${event.op} = ${op} and exists (select 1 from json_each(${payload}, ${path}) where value in concerned))`
        : sql`(${event.op} = ${op} and json_extract(${payload}, ${path}) in concerned)`,
    ),
    sql` or `,
  );
  return sql`(
    with recursive scope_tree(id) as (
      select ${scopeId}
      union all
      select b.id from ${block} b join scope_tree s on b.parent_id = s.id where b.deleted_at is null
    ),
    concerned(id) as materialized (select id from scope_tree union select id from ${block} where ${block.parentId} in (select id from scope_tree))
    select ${event.id} from ${event} where ${event.blockId} in concerned and ${window}
    union
    select ${event.id} from ${event} where ${inArray(event.op, PEER_OPS)} and ${window} and (${peers})
  )`;
}

export type JournalBatch = {
  blockId: number;
  sessionId: number | null;
  ops: string[];
  entries: number;
  firstEventId: number;
  lastEventId: number;
  firstTs: Date;
  lastTs: Date;
};

export function journalBatches(entries: readonly ActEntry[]): JournalBatch[] {
  const batches: JournalBatch[] = [];
  const open = new Map<number, JournalBatch>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.blockId === null) continue;
    const current = open.get(entry.blockId);
    if (current !== undefined && current.sessionId === entry.sessionId) {
      if (!current.ops.includes(entry.op)) current.ops.push(entry.op);
      current.entries += 1;
      current.lastEventId = entry.id;
      current.lastTs = entry.ts;
      continue;
    }
    const next: JournalBatch = {
      blockId: entry.blockId,
      sessionId: entry.sessionId,
      ops: [entry.op],
      entries: 1,
      firstEventId: entry.id,
      lastEventId: entry.id,
      firstTs: entry.ts,
      lastTs: entry.ts,
    };
    open.set(entry.blockId, next);
    batches.push(next);
  }
  return batches.sort((a, b) => b.lastEventId - a.lastEventId);
}

export const journalLayer: Layer.Layer<GraphJournal, never, GraphStore | GraphUnits | SessionNames> = Layer.effect(
  GraphJournal,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const names = yield* SessionNames;
    const reads = readsOf(yield* GraphUnits);

    return GraphJournal.of({
      events: reads(
        Effect.fn('Journal.events')(function* (
          filter: {
            blockId?: number;
            sinceId?: number;
            beforeId?: number;
            until?: Date;
            limit?: number;
            projectId?: number;
            scopeId?: number;
            concerning?: number;
            tags?: readonly string[];
            sessions?: readonly number[];
            ops?: readonly string[];
          } = {},
        ): Effect.fn.Return<ActEntry[], StoreFailure> {
          const conditions = [];
          if (filter.blockId !== undefined) conditions.push(eq(event.blockId, filter.blockId));
          if (filter.sinceId !== undefined) conditions.push(sql`${event.id} > ${filter.sinceId}`);
          if (filter.beforeId !== undefined) conditions.push(sql`${event.id} < ${filter.beforeId}`);
          if (filter.until !== undefined) conditions.push(lte(event.ts, filter.until));
          if (filter.scopeId !== undefined) conditions.push(sql`${event.blockId} in ${subtreeIds(filter.scopeId)}`);
          if (filter.sessions !== undefined) conditions.push(inArray(event.sessionId, [...filter.sessions]));
          if (filter.ops !== undefined) conditions.push(inArray(event.op, [...filter.ops] as GraphEventOp[]));
          if (filter.projectId !== undefined) conditions.push(eq(event.projectId, filter.projectId));
          if (filter.concerning !== undefined)
            conditions.push(
              sql`${event.id} in ${concerningIds(filter.concerning, conditions.length > 0 ? and(...conditions) : undefined)}`,
            );
          if (filter.tags === undefined) {
            const base = db
              .select()
              .from(event)
              .where(conditions.length > 0 ? and(...conditions) : undefined)
              .orderBy(sql`${event.id} desc`);
            return yield* filter.limit !== undefined ? base.limit(filter.limit) : base;
          }
          if (filter.tags !== undefined) conditions.push(carriesTag([...filter.tags], block.id));
          const base = db
            .select({ row: event })
            .from(event)
            .innerJoin(block, eq(block.id, event.blockId))
            .where(and(...conditions))
            .orderBy(sql`${event.id} desc`);
          const rows = yield* filter.limit !== undefined ? base.limit(filter.limit) : base;
          return rows.map((item) => item.row);
        }),
      ),

      vocabulary: reads(
        Effect.fn('Journal.vocabulary')(function* (filter: {
          projectId: number;
          scopeId?: number;
        }): Effect.fn.Return<JournalVocabulary, StoreFailure> {
          const conditions = [eq(event.projectId, filter.projectId)];
          if (filter.scopeId !== undefined) conditions.push(sql`${event.blockId} in ${subtreeIds(filter.scopeId)}`);
          const opRows = yield* db
            .selectDistinct({ op: event.op })
            .from(event)
            .where(and(...conditions));
          const sessionRows = yield* db
            .selectDistinct({ sessionId: event.sessionId, harness: session.harness, key: session.key })
            .from(event)
            .innerJoin(session, eq(session.id, event.sessionId))
            .where(and(...conditions));
          const tagRows = yield* db
            .selectDistinct({ tag: blockTag.tag })
            .from(blockTag)
            .innerJoin(block, eq(block.id, blockTag.blockId))
            .where(
              filter.scopeId === undefined
                ? eq(block.projectId, filter.projectId)
                : and(eq(block.projectId, filter.projectId), scopeCondition(filter.scopeId)),
            );
          const ops = new Set<string>(opRows.map((row) => row.op));
          const writers = new Map<number, { id: number; harness: string; key: string }>();
          for (const row of sessionRows) {
            if (row.sessionId !== null) writers.set(row.sessionId, { id: row.sessionId, harness: row.harness, key: row.key });
          }
          const sessions = yield* journalSessions(names, filter.projectId, [...writers.values()]);
          const written = GRAPH_EVENT_OPS.filter((op) => ops.has(op));
          const retired = [...ops].filter((op) => !GRAPH_EVENT_OPS.includes(op as GraphEventOp));
          return {
            sessions: sessions.sort((a, b) => b.id - a.id),
            ops: [...written, ...retired],
            tags: [...new Set(tagRows.map((row) => row.tag))],
          };
        }),
      ),

      writersIn: reads(
        Effect.fn('Journal.writersIn')(function* (input) {
          const { projectId } = input;
          const journalled = db
            .select({ id: event.sessionId })
            .from(event)
            .where(and(eq(event.projectId, projectId), isNotNull(event.sessionId)));
          const settled = db
            .select({ id: setting.sessionId })
            .from(setting)
            .where(and(eq(setting.scope, 'project'), eq(setting.projectId, projectId), isNotNull(setting.sessionId)));
          const matching = or(inArray(session.id, journalled), inArray(session.id, settled));
          const count = db
            .select({ total: sql<number>`count(*)`.as('total') })
            .from(session)
            .where(matching)
            .as('writer_count');
          const page = db
            .select()
            .from(session)
            .where(and(matching, input.before === undefined ? undefined : lt(session.id, input.before)))
            .orderBy(desc(session.id))
            .limit(input.limit)
            .as('writer_page');
          const result = yield* db
            .select({ writer: { id: page.id, harness: page.harness, key: page.key, createdAt: page.createdAt }, total: count.total })
            .from(count)
            .leftJoin(page, sql`1`)
            .orderBy(desc(page.id));
          return { rows: result.flatMap((row) => (row.writer === null ? [] : [row.writer])), total: result[0]?.total ?? 0 };
        }),
      ),

      newest: reads(
        Effect.fn('Journal.newest')(function* (
          ids: readonly number[],
          ops: readonly GraphEventOp[],
        ): Effect.fn.Return<ReadonlyMap<number, ActEntry>, StoreFailure> {
          const wanted = [...new Set(ids)];
          if (wanted.length === 0) return new Map<number, ActEntry>();
          const rows = yield* db
            .select()
            .from(event)
            .where(and(inArray(event.blockId, wanted), inArray(event.op, [...ops])))
            .orderBy(sql`${event.id} desc`);
          const newest = new Map<number, ActEntry>();
          for (const row of rows) {
            if (row.blockId !== null && !newest.has(row.blockId)) newest.set(row.blockId, row);
          }
          return newest;
        }),
      ),

      byCall: reads(
        Effect.fn('Journal.byCall')(function* (callId: string, sessionId: number | null): Effect.fn.Return<ActEntry[], StoreFailure> {
          return yield* db
            .select()
            .from(event)
            .where(and(eq(event.callId, callId), sessionId === null ? isNull(event.sessionId) : eq(event.sessionId, sessionId)))
            .orderBy(sql`${event.id} asc`);
        }),
      ),

      authors: reads(
        Effect.fn('Journal.authors')(function* (
          ids: readonly number[],
        ): Effect.fn.Return<ReadonlyMap<number, number | null>, StoreFailure> {
          const wanted = [...new Set(ids)];
          if (wanted.length === 0) return new Map<number, number | null>();
          const entries = yield* db
            .select({ blockId: event.blockId, sessionId: event.sessionId })
            .from(event)
            .where(and(inArray(event.blockId, wanted), eq(event.op, 'create')))
            .orderBy(sql`${event.id} asc`);
          const authors = new Map<number, number | null>();
          for (const entry of entries) {
            if (entry.blockId !== null && !authors.has(entry.blockId)) authors.set(entry.blockId, entry.sessionId);
          }
          return authors;
        }),
      ),

      touchedBy: reads(
        Effect.fn('Journal.touchedBy')(function* (
          sessionId: number,
          ids: readonly number[],
        ): Effect.fn.Return<ReadonlySet<number>, StoreFailure> {
          const wanted = [...new Set(ids)];
          const touched = new Set<number>();
          const size = rowsPerStatement(1) - 1;
          for (let at = 0; at < wanted.length; at += size) {
            for (const row of yield* db
              .selectDistinct({ blockId: event.blockId })
              .from(event)
              .where(and(eq(event.sessionId, sessionId), inArray(event.blockId, wanted.slice(at, at + size))))) {
              if (row.blockId !== null) touched.add(row.blockId);
            }
          }
          return touched;
        }),
      ),
    });
  }),
);

export const journalRevision = Effect.fn('Journal.revision')(function* (projectId: number) {
  const { identity } = yield* GraphStore;
  const newest = (yield* (yield* GraphJournal).events({ projectId, limit: 1 }))[0]?.id ?? 0;
  const mirror = yield* mirrorRevision();
  return `${identity.path}\0${identity.generation}\0${projectId}\0${newest}\0${mirror}`;
});
