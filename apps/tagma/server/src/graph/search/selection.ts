import { Effect, Layer, Result } from 'effect';
import { resolveAcross } from '../contract/wire/tags/selector.js';
import { fieldKeysOf, selectedTypes } from '../vocabulary/naming.js';
import { pageRows } from '@runlith/paging';
import { QUERY_WALK } from '../contract/wire/walks.js';
import { BLOCKS } from '../contract/wire/operations/shared.js';
import { outlineRows, subtreeShapes } from './outline.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { BlockQuery } from '../contract/wire/query.js';
import { type SQL, and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { block, spokenTail, edge } from '../store/tables.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { blockOwners } from '../store/owners.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { Tags } from '../contract/service/vocabulary.js';
import { carriesTag, contractAt, fieldIn, slotIn } from '../vocabulary/projection.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { WORK } from '../contract/wire/tags/work.js';
import { sourcePathsCondition } from '../sources/readers/place.js';
import { blockedCondition, ENDED_AT, measuredCondition } from '../acts/measurement.js';
import { farMarks, measuredOnce } from '../acts/far.js';
import type { FarHeld } from '../contract/service/foreign.js';
import { BlockNames } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { type BlockMeasurement, type BlockRecord, type BlockRow, MEASURED_FACTS } from '../contract/service/acts.js';
import { Selection, type BlockPosition, type BlockTitle, type ReadyPageFilter, type SelectionRefusal } from '../contract/service/reads.js';
import { standingCondition } from '../work/standingCondition.js';
import { blockName, TitleNames } from '../contract/wire/references.js';
import { GateRefusal, cursorRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { readsOf } from '../acts/reads.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { CurrentGraph } from '../contract/service/serving.js';

export function searchSnippet(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^[\s#>*-]+/, '').trim();
    if (line.length > 0) return line;
  }
  return '';
}

const TREE_COLUMNS = {
  id: block.id,
  uuid: block.uuid,
  path: block.path,
  projectId: block.projectId,
  parentId: block.parentId,
  ord: block.ord,
  tags: block.tags,
  fields: block.fields,
  title: block.title,
  deletedAt: block.deletedAt,
  createdAt: block.createdAt,
  updatedAt: block.updatedAt,
  stealth: block.stealth,
} as const;

export function readyFrontier(table: TagTable): { query: BlockQuery; where: SQL } {
  return {
    query: {
      tags: [...table.typesSupporting(WORK)],
      blocked: false,
      superseded: false,
      sort: { by: 'created', order: 'asc' },
    },
    where: contractAt(table, WORK, 'initial', block.id),
  };
}

type EdgeHop = { kind: NonNullable<BlockQuery['edge']>['kind']; to?: number; from?: number; transitive?: true };

function edgeCondition(hop: EdgeHop): SQL {
  if (hop.transitive) return edgeChainCondition(hop);
  return hop.to !== undefined
    ? sql`exists (select 1 from ${edge} e where e.from_id = ${block.id} and e.kind = ${hop.kind} and e.to_id = ${hop.to})`
    : sql`exists (select 1 from ${edge} e where e.to_id = ${block.id} and e.kind = ${hop.kind} and e.from_id = ${hop.from})`;
}

function edgeChainCondition(hop: EdgeHop): SQL {
  return hop.to !== undefined
    ? sql`${block.id} in (
        with recursive chain(id) as (
          select e.from_id from ${edge} e where e.kind = ${hop.kind} and e.to_id = ${hop.to}
          union
          select e.from_id from ${edge} e join chain c on e.to_id = c.id and e.kind = ${hop.kind}
        )
        select id from chain
      )`
    : sql`${block.id} in (
        with recursive chain(id) as (
          select e.to_id from ${edge} e where e.kind = ${hop.kind} and e.from_id = ${hop.from}
          union
          select e.to_id from ${edge} e join chain c on e.from_id = c.id and e.kind = ${hop.kind}
        )
        select id from chain
      )`;
}

export function orderingOf(sort: BlockQuery['sort']): SQL {
  const direction = sort.order === 'asc' ? sql`asc` : sql`desc`;
  if (sort.by === 'ended') {
    return sql`case when ${ENDED_AT} is null then 1 else 0 end asc, ${ENDED_AT} ${direction}, ${block.id} ${direction}`;
  }
  const column = sort.by === 'created' ? block.createdAt : block.updatedAt;
  return sql`${column} ${direction}, ${block.id} ${direction}`;
}

const READY_SORT: BlockQuery['sort'] = { by: 'created', order: 'asc' };

function keyColumnOf(sort: BlockQuery['sort']): SQL | typeof block.updatedAt {
  if (sort.by === 'ended') return ENDED_AT;
  return sort.by === 'created' ? block.createdAt : block.updatedAt;
}

export function keysetOf(sort: BlockQuery['sort'], [key, id]: BlockPosition): SQL {
  const forward = sort.order === 'asc';
  if (sort.by === 'ended' && key === null) {
    return forward ? sql`${ENDED_AT} is null and ${block.id} > ${id}` : sql`${ENDED_AT} is null and ${block.id} < ${id}`;
  }
  if (sort.by === 'ended') {
    return forward
      ? sql`${ENDED_AT} > ${key} or (${ENDED_AT} = ${key} and ${block.id} > ${id}) or ${ENDED_AT} is null`
      : sql`${ENDED_AT} < ${key} or (${ENDED_AT} = ${key} and ${block.id} < ${id}) or ${ENDED_AT} is null`;
  }
  const column = sort.by === 'created' ? block.createdAt : block.updatedAt;
  return forward
    ? sql`${column} > ${key} or (${column} = ${key} and ${block.id} > ${id})`
    : sql`${column} < ${key} or (${column} = ${key} and ${block.id} < ${id})`;
}

export function subtreeIds(scopeId: number): SQL {
  return sql`(
    with recursive scope_tree(id) as (
      select ${scopeId}
      union all
      select b.id from ${block} b join scope_tree s on b.parent_id = s.id where b.deleted_at is null
    )
    select id from scope_tree
  )`;
}

export function scopeCondition(scopeId: number): SQL {
  return sql`${block.id} in ${subtreeIds(scopeId)}`;
}

export const selectionLayer: Layer.Layer<Selection, never, GraphStore | BlockNames | BlockRows | Tags | GraphUnits> = Layer.effect(
  Selection,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const marked = readsOf(yield* GraphUnits);
    const reads = <F extends (...args: never[]) => Effect.Effect<unknown, unknown, unknown>>(verb: F): F =>
      marked(((...args: never[]) => measuredOnce(verb(...args))) as F);
    const blockNames = yield* BlockNames;
    const blockRows = yield* BlockRows;
    const vocabulary = yield* Tags;

    const conditionsOf = Effect.fn('Selection.conditionsOf')(function* (
      table: TagTable,
      q: BlockQuery,
      projectId: number,
      tags: readonly string[] | undefined,
    ): Effect.fn.Return<SQL[], GateRefusal<SelectionRefusal> | StoreFailure> {
      const measured = measuredCondition(table);
      const conditions: SQL[] = [sql`${block.deletedAt} is null`, sql`${block.projectId} = ${projectId}`];
      if (tags !== undefined) conditions.push(carriesTag(tags, block.id));
      const statuses = q.roles?.status ?? q.fields?.status;
      if (q.roles !== undefined) {
        const wanted = q.roles.status;
        if (wanted !== undefined)
          conditions.push(slotIn(table, LIFECYCLE, 'status', typeof wanted === 'string' ? [wanted] : wanted, block.id));
      }
      if (q.fields !== undefined) {
        for (const [name, wanted] of Object.entries(q.fields)) {
          const values = typeof wanted === 'string' ? [wanted] : wanted;
          const declaring = table.tagsWithField(name);
          const blind = tags?.filter((tag) => !declaring.includes(tag)) ?? [];
          if (tags !== undefined && tags.length > 0 && blind.length === tags.length) {
            return yield* new GateRefusal(
              'query-shape',
              `${blind.map((tag) => `#${tag}`).join(', ')} ${blind.length === 1 ? 'declares' : 'declare'} no "${name}", so a filter on it selects nothing`,
              [
                `drop "${name}" — a tag that declares no such field is selected by its tag alone`,
                `name a tag that does: ${name === 'status' ? table.statusLine() : declaring.map((tag) => `#${tag}`).join(', ')}`,
              ],
            );
          }
          conditions.push(fieldIn(name, values, block.id));
        }
      }

      const includesHistory =
        q.includeResting === true ||
        q.answered === true ||
        q.superseded === true ||
        (statuses !== undefined &&
          (typeof statuses === 'string' ? [statuses] : statuses).some((status) => table.hiddenStatuses().includes(status)));
      if (!includesHistory) conditions.push(standingCondition(table));

      if (q.scope !== undefined) {
        const subtrees = yield* Effect.forEach(q.scope, (name) =>
          Effect.map(blockNames.idOfName(name), (scopeId) => scopeCondition(scopeId)),
        );
        conditions.push(sql`(${sql.join(subtrees, sql` or `)})`);
      }
      if (q.anchorPaths !== undefined) {
        const inside = yield* sourcePathsCondition(q.anchorPaths);
        conditions.push(inside);
      }
      if (q.withoutAnchorPaths !== undefined) {
        const inside = yield* sourcePathsCondition(q.withoutAnchorPaths);
        conditions.push(sql`not (${inside})`);
      }
      if (q.edge !== undefined) {
        const hop = q.edge;
        conditions.push(
          edgeCondition({
            kind: hop.kind,
            transitive: hop.transitive,
            to: hop.to === undefined ? undefined : yield* blockNames.idOfName(hop.to),
            from: hop.from === undefined ? undefined : yield* blockNames.idOfName(hop.from),
          }),
        );
      }
      if (q.assigneeSessionId !== undefined) {
        conditions.push(slotIn(table, HOLDER, HOLDER_SLOT, [String(q.assigneeSessionId)], block.id));
      }
      if (q.since !== undefined) conditions.push(sql`${block.updatedAt} >= ${new Date(q.since).getTime()}`);
      for (const fact of MEASURED_FACTS) {
        const wanted = q[fact];
        if (wanted === undefined) continue;
        const condition = fact === 'blocked' ? blockedCondition(table, yield* farMarks(db, table, projectId)) : measured[fact];
        conditions.push(wanted ? sql`(${condition})` : sql`not (${condition})`);
      }
      return conditions;
    });

    const tablesOf = Effect.fn('Selection.tablesOf')(function* (projectId?: number) {
      const tables = new Map<number, TagTable>();
      const owners = projectId === undefined ? yield* blockOwners(db) : [projectId];
      for (const owner of owners) tables.set(owner, yield* vocabulary.of(owner));
      return tables;
    });

    const whereOf = Effect.fn('Selection.whereOf')(function* (
      q: BlockQuery,
      tables: ReadonlyMap<number, TagTable>,
    ): Effect.fn.Return<SQL, GateRefusal<SelectionRefusal> | StoreFailure> {
      if (q.tags !== undefined && q.selector !== undefined) {
        return yield* new GateRefusal('query-shape', 'tags and selector name two type selections', [
          'name selector, or keep tags for an exact selection',
        ]);
      }
      const selector = q.selector ?? (q.tags === undefined ? undefined : { kind: 'exact' as const, types: q.tags });
      const selected = selector === undefined ? undefined : resolveAcross(tables, selector);
      if (selected?._tag === 'Failure') {
        return yield* new GateRefusal(
          'query-shape',
          `${selected.failure.kind}: "${selected.failure.ref}" resolves to no unique declaration`,
          ['read the vocabulary of the project to select and name its type keys, permanent ids or registered contracts'],
        );
      }
      const perProject: SQL[] = [];
      for (const [owner, table] of tables) {
        const tags = selected?.success.get(owner);
        if (tags?.length === 0) continue;
        perProject.push(sql`(${sql.join(yield* conditionsOf(table, q, owner, tags), sql` and `)})`);
      }
      return perProject.length === 0 ? sql`0` : sql`(${sql.join(perProject, sql` or `)})`;
    });

    const rows = Effect.fn('Selection.rows')(function* (q: BlockQuery, projectId?: number) {
      const where = yield* whereOf(q, yield* tablesOf(projectId));
      const selected = db.select().from(block).where(where).orderBy(orderingOf(q.sort));
      return yield* q.limit === undefined ? selected : selected.limit(q.limit);
    });

    const list = Effect.fnUntraced(function* <TFact extends keyof BlockMeasurement>(given: readonly BlockRow[], facts: readonly TFact[]) {
      const parentIds = [...new Set(given.flatMap((row) => (row.parentId === null ? [] : [row.parentId])))];
      const parents =
        parentIds.length === 0
          ? []
          : yield* db.select({ id: block.id, title: block.title }).from(block).where(inArray(block.id, parentIds));
      const parentTitles = new Map(parents.map((row) => [row.id, row.title] as const));
      const measured = yield* blockRows.records(given, facts);
      return measured.map((row) => {
        const marks: Partial<BlockMeasurement> = {};
        for (const fact of facts) marks[fact] = row[fact];
        return {
          name: blockName(row.uuid),
          tags: row.tags,
          fields: row.fields,
          actions: row.actions,
          title: row.title,
          snippet: searchSnippet(row.body),
          parentTitle: row.parentId === null ? null : (parentTitles.get(row.parentId) ?? null),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          ...marks,
        };
      });
    });

    const keyedRows = Effect.fn('Selection.keyedRows')(function* (
      where: SQL,
      sort: BlockQuery['sort'],
      after: BlockPosition | undefined,
      rows: number,
    ) {
      const found = yield* db.all<{ id: number; k: number | null }>(sql`
          select ${block.id} as id, ${keyColumnOf(sort)} as k from ${block}
          where ${where}${after === undefined ? sql`` : sql` and (${keysetOf(sort, after)})`}
          order by ${orderingOf(sort)} limit ${rows}`);
      const counted = yield* db
        .select({ total: sql<number>`count(*)` })
        .from(block)
        .where(where)
        .get();
      if (counted === undefined) return yield* Effect.die('query count returned no row');
      return { found, total: counted.total };
    });

    const inOrder = Effect.fnUntraced(function* (ids: readonly number[]) {
      if (ids.length === 0) return [];
      const found = yield* db
        .select()
        .from(block)
        .where(inArray(block.id, [...ids]));
      const byId = new Map(found.map((row) => [row.id, row] as const));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [row];
      });
    });

    const frontierWhere = Effect.fnUntraced(function* (filter: {
      readonly projectId?: number | undefined;
      readonly scopeId?: number | undefined;
    }) {
      const scoped = filter.scopeId === undefined ? {} : { scope: [yield* blockNames.nameOf(filter.scopeId)] };
      const parts: SQL[] = [];
      for (const owner of filter.projectId === undefined ? yield* blockOwners(db) : [filter.projectId]) {
        const table = yield* vocabulary.of(owner);
        const frontier = readyFrontier(table);
        parts.push(sql`(${yield* whereOf({ ...frontier.query, ...scoped }, new Map([[owner, table]]))} and ${frontier.where})`);
      }
      return parts.length === 0 ? sql`0` : sql`(${sql.join(parts, sql` or `)})`;
    });

    const tableOver = Effect.fn('Selection.tableOver')(function* (blockId: number) {
      const owner = yield* db.select({ projectId: block.projectId }).from(block).where(eq(block.id, blockId)).get();
      return yield* vocabulary.of(owner?.projectId ?? 0);
    });

    return Selection.of({
      rows: reads(rows),
      list,

      query: reads(
        Effect.fn('Selection.query')(function* (projectId: number, q: BlockQuery) {
          const where = yield* whereOf(q, yield* tablesOf(projectId));
          const selected = db.select().from(block).where(where).orderBy(orderingOf(q.sort));
          const page = yield* q.limit === undefined ? selected : selected.limit(q.limit);
          const counted = yield* db
            .select({ total: sql<number>`count(*)` })
            .from(block)
            .where(where)
            .get();
          if (counted === undefined) return yield* Effect.die('query count returned no row');
          return { items: yield* list(page, MEASURED_FACTS), total: counted.total };
        }),
      ),

      queryPage: reads(
        Effect.fn('Selection.queryPage')(function* (projectId: number, given: BlockQuery, cursor?: string) {
          const table = yield* vocabulary.of(projectId);
          const pin = (word: string): string => table.identities.typeOf(word)?.id ?? word;
          const keyed =
            given.fields === undefined
              ? null
              : fieldKeysOf(table.identities, selectedTypes(table.identities, given.tags, given.selector), given.fields);
          if (keyed !== null && Result.isFailure(keyed)) {
            return yield* new GateRefusal(
              'query-shape',
              `"${keyed.failure.name}" names more than one field of the selected types (${keyed.failure.keys.join(', ')})`,
              [`filter by the field's key: ${keyed.failure.keys.join(' or ')}`, 'or narrow tags to the one type whose field this is'],
            );
          }
          const q: BlockQuery = {
            ...given,
            tags: given.tags?.map(pin),
            selector:
              given.selector === undefined || given.selector.kind === 'supports'
                ? given.selector
                : { ...given.selector, types: given.selector.types.map(pin) },
            fields: keyed === null ? given.fields : (keyed.success as NonNullable<BlockQuery['fields']>),
          };
          const keyedAt = Effect.fnUntraced(function* (after: BlockPosition | undefined, rows: number) {
            if (after !== undefined && after[0] === null && q.sort.by !== 'ended') return yield* cursorRefusal('bad-cursor');
            const slice = yield* keyedRows(yield* whereOf(q, new Map([[projectId, table]])), q.sort, after, rows);
            return { rows: slice.found, total: slice.total };
          });
          const cut = yield* walks.page({
            walk: QUERY_WALK,
            selection: { ...q, limit: undefined, projectId, checkout: (yield* CurrentGraph)?.checkout ?? null },
            cursor: cursor === '' ? undefined : cursor,
            asked: pageRows(q.limit, BLOCKS, ceilingOf(BLOCKS)),
            keyOf: (row: { readonly id: number; readonly k: number | null }) => [row.k, row.id] as const,
            read: keyedAt,
          });
          const ordered = yield* inOrder(cut.rows.map((row) => row.id));
          return { items: yield* list(ordered, MEASURED_FACTS), total: cut.total, nextCursor: cut.next };
        }),
      ),

      rowsPage: reads(
        Effect.fn('Selection.rowsPage')(function* (
          q: BlockQuery,
          projectId: number | undefined,
          after: BlockPosition | undefined,
          rows: number,
        ) {
          const slice = yield* keyedRows(yield* whereOf(q, yield* tablesOf(projectId)), q.sort, after, rows);
          return { rows: yield* inOrder(slice.found.map((hit) => hit.id)), total: slice.total };
        }),
      ),

      ready: reads(
        Effect.fn('Selection.ready')(function* (
          filter: { projectId?: number; scopeId?: number; among?: readonly number[] } = {},
        ): Effect.fn.Return<BlockRecord[], StoreFailure | GateRefusal<SelectionRefusal>> {
          if (filter.among?.length === 0) return [];
          const where = yield* frontierWhere(filter);
          const found = yield* db
            .select()
            .from(block)
            .where(filter.among === undefined ? where : and(where, inArray(block.id, [...filter.among])))
            .orderBy(orderingOf(READY_SORT));
          return yield* blockRows.details(found);
        }),
      ),

      readyPage: reads(
        Effect.fn('Selection.readyPage')(function* (filter: ReadyPageFilter) {
          const frontier = yield* frontierWhere(filter);
          const also = filter.also;
          const where =
            also === undefined || (also.ids.length === 0 && also.uuids.length === 0)
              ? frontier
              : sql`(${frontier} or ${also.ids.length === 0 ? sql`0` : inArray(block.id, [...also.ids])} or ${also.uuids.length === 0 ? sql`0` : inArray(block.uuid, [...also.uuids])})`;
          const slice = yield* keyedRows(where, READY_SORT, filter.after, filter.rows);
          return { rows: yield* blockRows.details(yield* inOrder(slice.found.map((hit) => hit.id))), total: slice.total };
        }),
      ),

      held: reads(
        Effect.fn('Selection.held')(function* (filter: { readonly projectId: number | undefined; readonly scopeId: number | undefined }) {
          const held: FarHeld[] = [];
          for (const owner of filter.projectId === undefined ? yield* blockOwners(db) : [filter.projectId]) {
            const table = yield* vocabulary.of(owner);
            const marks = yield* farMarks(db, table, owner);
            if (marks.held.length === 0) continue;
            const standing = yield* db
              .select({ id: block.id })
              .from(block)
              .where(
                and(
                  inArray(block.id, [...new Set(marks.held.map((one) => one.id))]),
                  sql`not (${measuredCondition(table).superseded})`,
                  filter.scopeId === undefined ? undefined : scopeCondition(filter.scopeId),
                ),
              );
            const kept = new Set(standing.map((row) => row.id));
            held.push(...marks.held.filter((one) => kept.has(one.id)));
          }
          return held;
        }),
      ),

      roots: reads(
        Effect.fn('Selection.roots')(function* (projectId: number) {
          const found = yield* db
            .select()
            .from(block)
            .where(and(eq(block.projectId, projectId), isNull(block.parentId), isNull(block.deletedAt)))
            .orderBy(block.ord);
          return yield* blockRows.details(found);
        }),
      ),

      tree: reads(
        Effect.fn('Selection.tree')(function* (projectId: number) {
          const found = yield* db
            .select(TREE_COLUMNS)
            .from(block)
            .where(and(eq(block.projectId, projectId), isNull(block.deletedAt)))
            .orderBy(asc(block.ord), asc(block.id));
          return yield* blockRows.records(found, MEASURED_FACTS);
        }),
      ),

      subtree: reads(
        Effect.fn('Selection.subtree')(function* (scopeId: number) {
          const found = yield* db.all<{ id: number }>(sql`
          with recursive scope_tree(id) as (
            select ${scopeId}
            union all
            select b.id from ${block} b join scope_tree s on b.parent_id = s.id where b.deleted_at is null
          )
          select id from scope_tree
        `);
          return new Set(found.map((row) => row.id));
        }),
      ),

      shape: reads(
        Effect.fn('Selection.shape')(function* (rootId: number) {
          const found = yield* subtreeShapes(db, yield* tableOver(rootId), rootId, [rootId]);
          return found.get(rootId)!;
        }),
      ),

      outline: reads(
        Effect.fn('Selection.outline')(function* (rootId: number, depth: number, all: boolean) {
          const table = yield* tableOver(rootId);
          const outline = yield* outlineRows(db, table, rootId, depth, all);
          const shapes = yield* subtreeShapes(db, table, rootId, outline.ids);
          const rows = yield* db.select().from(block).where(inArray(block.id, outline.ids));
          return { rows, children: outline.children, shapes };
        }),
      ),

      records: reads(
        Effect.fn('Selection.records')(function* (ids: readonly number[]) {
          if (ids.length === 0) return [];
          const found = yield* db
            .select()
            .from(block)
            .where(inArray(block.id, [...ids]));
          return yield* blockRows.details(found);
        }),
      ),

      titles: reads(
        Effect.fn('Selection.titles')(function* (names: readonly string[]) {
          const requested = new TitleNames(names);
          const tails = requested.tails;
          if (tails.length === 0) return [];
          const found: BlockTitle[] = [];
          const room = rowsPerStatement(1);
          for (let at = 0; at < tails.length; at += room) {
            const rows = yield* db
              .select({ uuid: block.uuid, title: block.title, projectId: block.projectId })
              .from(block)
              .where(and(inArray(spokenTail, tails.slice(at, at + room)), isNull(block.deletedAt)));
            for (const row of rows) {
              for (const name of requested.matches(row.uuid, row.projectId)) found.push({ ...row, name });
            }
          }
          return found;
        }),
      ),
    });
  }),
);
