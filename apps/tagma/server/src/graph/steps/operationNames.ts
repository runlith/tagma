import { Clock, Effect } from 'effect';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block, event } from '../store/tables.js';
import { RENAMED_OPERATIONS, type Renames } from './renamedOperations.js';

const jsonValue = (type: SQL, value: SQL): SQL => sql`case
  when ${type} in ('object', 'array') then ${value}
  when ${type} = 'true' then 'true'
  when ${type} = 'false' then 'false'
  else json_quote(${value}) end`;
const object = (type: SQL, value: SQL): SQL => sql`case when ${type} = 'object' then ${value} else '{}' end`;
const on = (doc: SQL): SQL => sql`case when json_type(${doc}, '$.on') = 'array' then json_extract(${doc}, '$.on') else '[]' end`;
const trigger = object(sql`t.type`, sql`t.value`);
const field = object(sql`f.type`, sql`f.value`);
const at = (doc: SQL, path: string): SQL => object(sql`json_type(${doc}, ${path})`, sql`json_extract(${doc}, ${path})`);

const renaming = (names: Renames, span: string) => {
  const stepping = writes(`Tree.step.${span}`, [block, event]);
  const before = sql.join(
    names.map(([name]) => sql`${name}`),
    sql`, `,
  );
  const renamed = (value: SQL): SQL => sql`case ${value}
  ${sql.join(
    names.map(([from, to]) => sql`when ${from} then ${to}`),
    sql` `,
  )} else ${value} end`;
  const old = sql`t.type = 'object' and json_extract(${trigger}, '$.op') in (${before})
  and json_extract(${trigger}, '$.phase') in ('before', 'after')`;
  const changed = (doc: SQL): SQL => sql`json_extract(${doc}, '$.strictness') in ('note', 'watch', 'gate', 'off')
  and exists (select 1 from json_each(${on(doc)}) t where ${old})`;
  const document = (doc: SQL): SQL => sql`case when ${changed(doc)} then json_set(${doc}, '$.on', json(
  (select json_group_array(json(case when ${old}
    then json_set(${trigger}, '$.op', ${renamed(sql`json_extract(${trigger}, '$.op')`)})
    else ${jsonValue(sql`t.type`, sql`t.value`)} end)) from json_each(${on(doc)}) t))) else ${doc} end`;
  const fieldsChanged = (fields: SQL): SQL =>
    sql`exists (select 1 from json_each(${fields}) f where f.type = 'object' and ${changed(field)})`;
  const fieldsDocument = (fields: SQL): SQL => sql`case when ${fieldsChanged(fields)} then
  (select json_group_object(f.key, json(case when f.type = 'object' then ${document(field)}
    else ${jsonValue(sql`f.type`, sql`f.value`)} end)) from json_each(${fields}) f) else ${fields} end`;

  return Effect.fn(`GraphStep.${span}`)(function* (project: ProjectRow) {
    const store = yield* GraphStore;
    const { db } = store;
    yield* store.transaction(stepping, () =>
      Effect.gen(function* () {
        yield* db
          .update(block)
          .set({ fields: fieldsDocument(sql`${block.fields}`), updatedAt: new Date(yield* Clock.currentTimeMillis) })
          .where(and(eq(block.projectId, project.id), fieldsChanged(sql`${block.fields}`)));
        const payload = sql`case when json_valid(${event.payload}) then ${event.payload} else '{}' end`;
        const was = at(payload, '$.was');
        const wasFields = at(payload, '$.wasFields');
        const root = document(payload);
        const prior = sql`case when ${changed(was)} then json_set(${root}, '$.was', json(${document(was)})) else ${root} end`;
        const next = sql`case when ${fieldsChanged(wasFields)} then
        json_set(${prior}, '$.wasFields', json(${fieldsDocument(wasFields)})) else ${prior} end`;
        yield* db
          .update(event)
          .set({ payload: next })
          .where(
            and(
              eq(event.projectId, project.id),
              inArray(event.op, ['enforce', 'update']),
              sql`(${changed(payload)} or ${changed(was)} or ${fieldsChanged(wasFields)})`,
            ),
          );
      }),
    );
  });
};

export const operationNames = renaming(RENAMED_OPERATIONS.contract, 'operationNames');

export const ruleOperationNames = renaming(RENAMED_OPERATIONS.rules, 'ruleOperationNames');
