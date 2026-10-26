import { Clock, Effect } from 'effect';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block } from '../store/tables.js';

const stepping = writes('Tree.step.creationEdges', [block]);

const jsonValue = (type: SQL, value: SQL): SQL => sql`case
  when ${type} in ('object', 'array') then ${value}
  when ${type} = 'true' then 'true'
  when ${type} = 'false' then 'false'
  else json_quote(${value}) end`;

export const creationEdges = Effect.fn('GraphStep.creationEdges')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const object = sql`case when op.type = 'object' then op.value else '{}' end`;
  const array = sql`case when f.type = 'array' then f.value else '[]' end`;
  const old = sql`json_extract(${object}, '$.op') = 'create'
    and (json_type(${object}, '$.implementsId') is not null or json_type(${object}, '$.discoveredFromId') is not null)
    and (json_type(${object}, '$.edges') is null or json_type(${object}, '$.edges') = 'array')`;
  const edges = sql`coalesce(json_extract(${object}, '$.edges'), '[]')`;
  const implementing = sql`case when json_type(${object}, '$.implementsId') is null then ${edges}
    else json_insert(${edges}, '$[#]', json_object('kind', 'implements', 'to', json_extract(${object}, '$.implementsId'))) end`;
  const discovering = sql`case when json_type(${object}, '$.discoveredFromId') is null then ${implementing}
    else json_insert(${implementing}, '$[#]', json_object('kind', 'discovered-from', 'to', json_extract(${object}, '$.discoveredFromId'))) end`;
  const creation = sql`json_set(json_remove(${object}, '$.implementsId', '$.discoveredFromId'), '$.edges', json(${discovering}))`;
  const ops = sql`(select json_group_array(json(case when ${old} then ${creation}
    else ${jsonValue(sql`op.type`, sql`op.value`)} end)) from json_each(${array}) op)`;
  const changed = sql`f.type = 'array' and exists (select 1 from json_each(${array}) op where ${old})`;
  const fields = sql`(select json_group_object(f.key, json(case when ${changed} then ${ops}
    else ${jsonValue(sql`f.type`, sql`f.value`)} end)) from json_each(${block.fields}) f)`;
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      yield* db
        .update(block)
        .set({ fields, updatedAt: new Date(yield* Clock.currentTimeMillis) })
        .where(and(eq(block.projectId, project.id), sql`exists (select 1 from json_each(${block.fields}) f where ${changed})`));
    }),
  );
});
