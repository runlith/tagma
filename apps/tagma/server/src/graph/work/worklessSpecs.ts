import { Effect } from 'effect';
import { type SQL, sql } from 'drizzle-orm';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { WORK } from '../contract/wire/tags/work.js';
import { carriesContract, contractAt } from '../vocabulary/projection.js';
import { openWork, type OpenWork } from '../contract/wire/openWork.js';
import type { WorklessSpec, WorklessSpecs } from '../contract/service/work.js';

export const openWorkOf = (table: TagTable): OpenWork => ({
  open: [...table.wordsAt(WORK, 'initial'), ...table.wordsAt(WORK, 'active')],
  kinds: table.semanticEdges('implementation').map((rule) => rule.kind),
});

function implementing(table: TagTable): SQL {
  const kinds = table.semanticEdges('implementation').map((rule) => sql`${rule.kind}`);
  return kinds.length === 0 ? sql`(null)` : sql`(${sql.join(kinds, sql`, `)})`;
}

const idList = (ids: readonly number[]): SQL =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

function candidates(where: WorklessSpecs, kinds: SQL): SQL {
  if ('above' in where) {
    return sql`
      select s.id from block s
      where s.project_id = ${where.projectId} and s.deleted_at is null
        and (s.id in (select id from up)
          or s.id in (select e.to_id from edge e where e.from_id in ${idList(where.above)} and e.kind in ${kinds}))`;
  }
  return where.scopeId === undefined
    ? sql`select s.id from block s where s.project_id = ${where.projectId} and s.deleted_at is null`
    : sql`select s.id from block s where s.id in (select id from inside) and s.deleted_at is null`;
}

export const worklessSpecsOf = Effect.fn('worklessSpecsOf')(function* (
  db: GraphStore['Service']['db'],
  table: TagTable,
  where: WorklessSpecs,
): Effect.fn.Return<readonly WorklessSpec[], StoreFailure> {
  const kinds = implementing(table);
  const work = openWork(openWorkOf(table));
  const start = 'above' in where ? 0 : (where.scopeId ?? 0);
  const below = 'above' in where ? where.above : [start];
  if (below.length === 0) return [];
  return yield* db.all<WorklessSpec>(sql`
    with recursive up(id) as (
      select parent_id from block where id in ${idList(below)} and parent_id is not null
      union
      select b.parent_id from block b join up on b.id = up.id where b.parent_id is not null
    ),
    inside(id) as (
      select ${start}
      union
      select b.id from block b join inside on b.parent_id = inside.id where b.deleted_at is null
    ),
    candidate(id) as (
      select s.id from (${candidates(where, kinds)}) s
      join block c on c.id = s.id
      where ${carriesContract(table, SPEC, sql`c.id`)}
        and ${contractAt(table, LIFECYCLE, 'open', sql`c.id`)}
        and not exists (select 1 from edge x where x.kind = 'supersedes' and x.to_id = c.id)
    ),
    ${sql.raw(work.below('select id from candidate'))}
    select s.uuid as uuid, s.title as title from block s
    where s.id in (select id from candidate)
      and not ${sql.raw(work.hasOpenWork('s.id'))}
    order by s.id
  `);
});
