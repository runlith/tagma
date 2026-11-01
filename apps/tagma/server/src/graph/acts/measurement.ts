import { Effect } from 'effect';
import { type SQL, inArray, sql } from 'drizzle-orm';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { block, edge, event } from '../store/tables.js';
import { type Tagged, hasTag } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { Tags } from '../contract/service/vocabulary.js';
import { carriesTag } from '../vocabulary/projection.js';
import { type Answer, type BlockMeasurement, type MeasuredBlock, BlockAnswers } from '../contract/service/acts.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { OBSERVATION } from '../contract/wire/tags/observation.js';
import { carriesContract, contractAt, contractNotAt } from '../vocabulary/projection.js';
import { farMarks } from './far.js';
import type { FarMarks } from '../contract/service/foreign.js';

type ProjectedMarks = { readonly id: number; readonly parentUuid: string | null } & {
  readonly [F in keyof BlockMeasurement]: number;
};

const answering = new WeakMap<TagTable, readonly string[]>();

function answeringTags(table: TagTable): readonly string[] {
  let tags = answering.get(table);
  if (tags === undefined) {
    tags = table.tags.flatMap((tag) =>
      tag.contracts?.[LIFECYCLE] === undefined && table.lawProjectionOf(tag.id) !== null ? [tag.id] : [],
    );
    answering.set(table, tags);
  }
  return tags;
}

function finishedWork(table: TagTable): SQL {
  return sql`(${contractAt(table, LIFECYCLE, 'terminal', sql`b.id`)} or ${carriesTag(answeringTags(table), sql`b.id`)})`;
}

export function isFinishedWork(table: TagTable, row: Tagged): boolean {
  return table.isTerminal(row) || answeringTags(table).some((tag) => hasTag(row, tag));
}

const unwithdrawn = (named: 'by' | 'commit', value: SQL, after?: SQL): SQL =>
  sql`not exists (select 1 from ${event} w where w.op = 'unanswer' and w.block_id = ${block.id}
    and json_extract(w.payload, ${`$.${named}`}) = ${value}${after === undefined ? sql`` : sql` and w.id > ${after}`})`;

const standsFinished = (table: TagTable): SQL => sql`b.deleted_at is null and ${finishedWork(table)}
      and not exists (select 1 from ${edge} s where s.kind = 'supersedes' and s.to_id = b.id)`;

const discoveredAnswers = (table: TagTable | null): SQL => sql`select b.id from ${edge} e join ${block} b on b.id = e.from_id
    where e.kind = 'discovered-from' and e.to_id = ${block.id} and ${unwithdrawn('by', sql`b.id`)}${
      table === null ? sql`` : sql` and ${standsFinished(table)}`
    }`;

const namedAnswers = (
  table: TagTable | null,
): SQL => sql`select b.id from ${event} ev join ${block} b on b.id = json_extract(ev.payload, '$.by')
    where ev.op = 'answer' and ev.block_id = ${block.id} and ${unwithdrawn('by', sql`b.id`, sql`ev.id`)}${
      table === null ? sql`` : sql` and ${standsFinished(table)}`
    }`;

const committedAnswers = sql`select json_extract(ev.payload, '$.commit') from ${event} ev
    where ev.op = 'answer' and ev.block_id = ${block.id} and json_extract(ev.payload, '$.commit') is not null
      and ${unwithdrawn('commit', sql`json_extract(ev.payload, '$.commit')`, sql`ev.id`)}`;

function answeredBy(table: TagTable): SQL {
  return sql`coalesce(
  (${discoveredAnswers(table)} order by b.id limit 1),
  (${namedAnswers(table)} order by ev.ts limit 1)
)`;
}

const answeredCommit = sql`(${committedAnswers} order by ev.ts limit 1)`;

const checkedWhere = sql`ev.op = 'answer' and ev.block_id = ${block.id} and json_type(ev.payload, '$.checked') = 'text'
      and not exists (select 1 from ${event} w where w.op = 'unanswer' and w.block_id = ${block.id}
        and json_extract(w.payload, '$.checked') is not null and w.id > ev.id)`;

const checkedAnswers = sql`select ev.id from ${event} ev where ${checkedWhere}`;

const answeredChecked = sql`(${checkedAnswers} order by ev.ts limit 1)`;

const checkedFact = (path: string) =>
  sql`(select json_extract(ev.payload, ${path}) from ${event} ev where ${checkedWhere} order by ev.ts limit 1)`;

function answerState(answer: Answer): { live: SQL; named: SQL } {
  if (answer.kind === 'checked') {
    return {
      live: sql`exists (${checkedAnswers})`,
      named: sql`exists (select 1 from ${event} ev where ev.op = 'answer' and ev.block_id = ${block.id}
        and json_type(ev.payload, '$.checked') = 'text')`,
    };
  }
  if (answer.kind === 'commit') {
    return {
      live: sql`exists (${committedAnswers} and json_extract(ev.payload, '$.commit') = ${answer.sha})`,
      named: sql`exists (select 1 from ${event} ev where ev.op = 'answer' and ev.block_id = ${block.id}
        and json_extract(ev.payload, '$.commit') = ${answer.sha})`,
    };
  }
  return {
    live: sql`(exists (${discoveredAnswers(null)} and b.id = ${answer.id}) or exists (${namedAnswers(null)} and b.id = ${answer.id}))`,
    named: sql`(exists (select 1 from ${edge} e where e.kind = 'discovered-from' and e.from_id = ${answer.id} and e.to_id = ${block.id})
      or exists (select 1 from ${event} ev where ev.op = 'answer' and ev.block_id = ${block.id} and json_extract(ev.payload, '$.by') = ${answer.id}))`,
  };
}

export function blockedCondition(table: TagTable, far: FarMarks): SQL {
  return sql.join(
    table
      .semanticEdges('dependency')
      .map(
        (rule) => sql`(${carriesContract(table, rule.from, block.id)} and ${contractAt(table, rule.from, 'initial', block.id)} and exists (
    select 1 from ${edge} e join ${block} b on b.id = e.to_id
    where e.kind = ${rule.kind} and e.from_id = ${block.id} and b.deleted_at is null
      and ${contractNotAt(table, rule.to, 'terminal', sql`b.id`)}
      and not exists (select 1 from ${edge} s where s.kind = 'supersedes' and s.to_id = b.id)))`,
      )
      .concat(far.blocked.size === 0 ? [] : [inArray(block.id, [...far.blocked])])
      .concat(sql`0`),
    sql` or `,
  );
}

export function measuredCondition(table: TagTable): Record<Exclude<keyof BlockMeasurement, 'blocked'>, SQL> {
  return {
    superseded: sql`exists (select 1 from ${edge} e where e.kind = 'supersedes' and e.to_id = ${block.id})`,
    building: sql.join(
      table
        .semanticEdges('implementation')
        .map(
          (rule) => sql`(${carriesContract(table, rule.to, block.id)} and exists (
    select 1 from ${edge} e join ${block} b on b.id = e.from_id
    where e.kind = ${rule.kind} and e.to_id = ${block.id} and b.deleted_at is null
      and ${contractAt(table, rule.from, 'active', sql`b.id`)}
      and not exists (select 1 from ${edge} s where s.kind = 'supersedes' and s.to_id = b.id)))`,
        )
        .concat(sql`0`),
      sql` or `,
    ),
    answered: sql`${carriesContract(table, OBSERVATION, block.id)} and ((${answeredBy(table)}) is not null or (${answeredCommit}) is not null
      or (${answeredChecked}) is not null)`,
  };
}

export const ENDED_AT = sql`(select max(e.ts) from ${event} e
  where e.block_id = ${block.id} and e.op in ('done', 'close'))`;

export function actMarks(db: GraphStore['Service']['db'], tags: Tags['Service']) {
  const records = Effect.fnUntraced(function* <
    TRow extends { id: number; projectId: number; tags: readonly string[] },
    TFact extends keyof BlockMeasurement,
  >(rows: readonly TRow[], facts: readonly TFact[]) {
    const result: MeasuredBlock<TRow, TFact>[] = [];
    if (rows.length === 0) return result;
    const byProject = new Map<number, number[]>();
    for (const row of rows) {
      const group = byProject.get(row.projectId);
      if (group === undefined) byProject.set(row.projectId, [row.id]);
      else group.push(row.id);
    }
    const projected = new Map<number, ProjectedMarks>();
    const tables = new Map<number, TagTable>();
    const wanted = new Set<keyof BlockMeasurement>(facts);
    for (const [projectId, ids] of byProject) {
      const table = yield* tags.of(projectId);
      tables.set(projectId, table);
      const measured = measuredCondition(table);
      const blocked = wanted.has('blocked') ? blockedCondition(table, yield* farMarks(db, table, projectId, ids)) : sql`0`;
      for (const row of yield* db.all<ProjectedMarks>(sql`
            select ${block.id} as id,
              (select parent.uuid from ${block} parent where parent.id = ${block.parentId}) as parentUuid,
              case when (${wanted.has('superseded') ? measured.superseded : sql`0`}) then 1 else 0 end as superseded,
              case when (${blocked}) then 1 else 0 end as blocked,
              case when (${wanted.has('building') ? measured.building : sql`0`}) then 1 else 0 end as building,
              case when (${wanted.has('answered') ? measured.answered : sql`0`}) then 1 else 0 end as answered
            from ${block}
            where ${inArray(block.id, ids)}
          `)) {
        projected.set(row.id, row);
      }
    }
    for (const row of rows) {
      const projection = projected.get(row.id);
      if (projection === undefined) return yield* Effect.die(`record projection lost block ${row.id}`);
      const marks = {} as Pick<BlockMeasurement, TFact>;
      for (const fact of facts) marks[fact] = projection[fact] === 1;
      result.push({
        ...row,
        ...marks,
        actions: tables.get(row.projectId)!.actionsOn(row),
        parentUuid: projection.parentUuid,
      });
    }
    return result;
  });

  return { records };
}

export function blockAnswers(db: GraphStore['Service']['db'], tags: Tags['Service']): BlockAnswers['Service'] {
  const answersOf: BlockAnswers['Service']['answersOf'] = Effect.fn('Act.answersOf')(function* (ids: readonly number[]) {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return new Map<number, Answer>();
    const owners = yield* db.select({ id: block.id, projectId: block.projectId }).from(block).where(inArray(block.id, wanted));
    const byProject = new Map<number, number[]>();
    for (const row of owners) {
      const group = byProject.get(row.projectId);
      if (group === undefined) byProject.set(row.projectId, [row.id]);
      else group.push(row.id);
    }
    const found = new Map<number, Answer>();
    for (const [projectId, group] of byProject) {
      const rows = yield* db
        .select({
          id: block.id,
          answerId: sql<number | null>`(${answeredBy(yield* tags.of(projectId))})`,
          commit: sql<string | null>`${answeredCommit}`,
          checked: sql<string | null>`${checkedFact('$.checked')}`,
          checkedHead: sql<string | null>`${checkedFact('$.head')}`,
        })
        .from(block)
        .where(inArray(block.id, group));
      for (const row of rows) {
        if (row.answerId !== null) found.set(row.id, { kind: 'block', id: row.answerId });
        else if (row.commit !== null) found.set(row.id, { kind: 'commit', sha: row.commit });
        else if (row.checked !== null) found.set(row.id, { kind: 'checked', finding: row.checked, head: row.checkedHead });
      }
    }
    return found;
  });

  return BlockAnswers.of({
    answerOf: Effect.fn('Act.answerOf')(function* (id: number) {
      return (yield* answersOf([id])).get(id) ?? null;
    }),

    answersOf,

    answerStateOf: Effect.fn('Act.answerStateOf')(function* (id: number, answer: Answer) {
      const asked = answerState(answer);
      const [row] = yield* db.all<{ live: number; named: number }>(sql`
        select case when ${asked.live} then 1 else 0 end as live, case when ${asked.named} then 1 else 0 end as named
        from ${block} where ${block.id} = ${id}
      `);
      if (row === undefined || row.named === 0) return 'never' as const;
      return row.live === 1 ? ('live' as const) : ('withdrawn' as const);
    }),

    answeredCommits: Effect.fn('Act.answeredCommits')(function* (id: number) {
      const rows = yield* db.all<{ sha: string }>(sql`
        select distinct json_extract(${event.payload}, '$.commit') as sha from ${event}
        where ${event.op} = 'answer' and ${event.blockId} = ${id} and json_extract(${event.payload}, '$.commit') is not null
      `);
      return rows.map((row) => row.sha);
    }),
  });
}
