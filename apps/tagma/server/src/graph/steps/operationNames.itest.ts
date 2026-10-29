import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block, event } from '../store/tables.js';
import { operationNames, ruleOperationNames } from './operationNames.js';

const pairs = [
  ['claim_task', 'claim_block'],
  ['release_task', 'release_block'],
  ['ready_tasks', 'ready_work'],
  ['enforce_rule', 'enforce_rule'],
  ['enforce_law', 'enforce_rule'],
  ['check_law', 'check_rules'],
  ['set_law_enabled', 'set_rule_enabled'],
  ['set_law_delivery', 'set_rule_delivery'],
] as const;
const stepped = (project: ProjectRow) => Effect.andThen(operationNames(project), ruleOperationNames(project));
const triggers = (after: boolean) => pairs.map((pair, index) => ({ op: pair[after ? 1 : 0], phase: index % 2 === 0 ? 'before' : 'after' }));
const document = (after: boolean) => ({
  strictness: 'gate',
  on: [...triggers(after), { op: 'submit_work', phase: 'before' }],
  checks: [{ builtin: 'modules', params: {} }],
  debt: [],
  escaped: [],
});

layer(demoGraphLayer({ projects: ['elsewhere'] }), { excludeTestServices: true })('operation names', (it) => {
  it.effect(
    'custom enforcement slots and journal documents migrate without changing acts, free text, other projects or unrelated JSON',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId } = demo;
          const { db } = graph.graphStore;
          const target = yield* graph.blocks.create({ projectId, parentId: demo.root, title: 'an enforcement document' });
          const elsewhere = demo.project('elsewhere').id;
          const untouched = yield* graph.blocks.create({
            projectId: elsewhere,
            parentId: (yield* graph.blocks.rootBlockOf(elsewhere)).id,
            title: 'another project',
          });
          const fields = (after: boolean) => ({
            guard: document(after),
            text: 'claim_task and done are words somebody wrote',
            arbitrary: { on: [{ op: 'claim_task', phase: 'before' }] },
            null: null,
            flag: false,
            number: 3,
            list: ['claim_task'],
          });
          yield* db
            .update(block)
            .set({ fields: fields(false) })
            .where(inArray(block.id, [target.id, untouched.id]));
          const payload = (after: boolean) => ({
            strictness: 'gate',
            on: triggers(after),
            was: document(after),
            wasFields: fields(after),
            reason: 'use claim_task',
          });
          const now = new Date(0);
          const events = yield* db
            .insert(event)
            .values([
              { projectId, blockId: target.id, ts: now, op: 'enforce', payload: JSON.stringify(payload(false)) },
              { projectId, blockId: target.id, ts: now, op: 'update', payload: JSON.stringify({ wasFields: fields(false) }) },
              { projectId, blockId: target.id, ts: now, op: 'done', payload: JSON.stringify({ reason: 'claim_task' }) },
            ])
            .returning();
          const project = yield* graph.projects.byId(projectId);
          yield* stepped(project);
          const rows = () =>
            db
              .select()
              .from(block)
              .where(inArray(block.id, [target.id, untouched.id]))
              .orderBy(block.id);
          const journal = () =>
            db
              .select()
              .from(event)
              .where(
                and(
                  eq(event.projectId, projectId),
                  inArray(
                    event.id,
                    events.map((row) => row.id),
                  ),
                ),
              )
              .orderBy(event.id);
          const once = { rows: yield* rows(), events: yield* journal() };
          expect(once.rows.find((row) => row.id === target.id)?.fields).toEqual(fields(true));
          expect(once.rows.find((row) => row.id === untouched.id)?.fields).toEqual(fields(false));
          expect(once.events.map((row) => row.op)).toEqual(['enforce', 'update', 'done']);
          expect(once.events.map((row) => JSON.parse(row.payload))).toEqual([
            payload(true),
            { wasFields: fields(true) },
            { reason: 'claim_task' },
          ]);
          yield* ruleOperationNames(project);
          expect({ rows: yield* rows(), events: yield* journal() }).toEqual(once);
        }),
      ),
  );
});
