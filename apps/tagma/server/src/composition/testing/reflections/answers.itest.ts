import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { BlockAnswers } from '../../../graph/contract/service/acts.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { fileReflection, filedReflections } from '../../../reflections/filing.js';

const testActing = writes('test', []);
const facts = { command: 'tagma x', expected: 'one act', actual: 'four calls' };
const file = Effect.map(fileReflection({ title: 'friction', ...facts }), (filed) => filed.entry.id);
const standing = Effect.map(filedReflections(undefined, 100), (page) => page.rows.map((row) => row.id));

layer(demoGraphLayer(), { excludeTestServices: true })('a reflection stops standing when something answers it', (it) => {
  it.effect('a filing carries its body with its facts, and a recurring sighting is its child', () =>
    withDemo(() =>
      Effect.gen(function* () {
        const filed = yield* fileReflection({ title: 'with prose', ...facts, body: 'Eleven acts, five of them rewrites.' });
        const prose = filed.entry;
        expect(prose.body).toContain('Eleven acts, five of them rewrites.');
        expect(prose.fields).toEqual({ ...facts });
        const again = yield* fileReflection({ title: 'once more', ...facts, ontoId: prose.id, body: 'And a sixth, the next day.' });
        expect(again.entry).toMatchObject({ id: prose.id, body: prose.body, sightings: 2 });
        expect(again.written).toMatchObject({ parentId: prose.id, body: expect.stringMatching(/And a sixth, the next day\.$/) });
        expect(again.written.fields).toEqual({ ...facts });
      }),
    ),
  );

  it.effect('a rule filed against the entry answers it by being written; an open task does not', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const entry = yield* file;
        const task = (yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['task'],
          title: 'fix the tool',
          edges: [{ kind: 'discovered-from', to: entry }],
        })).id;
        expect(yield* standing).toContain(entry);
        yield* graph.tasks.finish({ id: task });
        expect(yield* standing).not.toContain(entry);
        const second = yield* file;
        yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['rule'],
          title: 'what the tool does now',
          edges: [{ kind: 'discovered-from', to: second }],
        });
        expect(yield* standing).not.toContain(second);
      }),
    ),
  );

  it.effect('an answer must be finished work, and the measure holds a record to the same rule', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const entry = yield* file;
        const task = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'fix the tool' })).id;
        const refused = yield* demo.refusal(graph.reflection.answer({ id: entry, byId: task }));
        expect(refused.code).toBe('not-finished');
        expect(refused.reason).toContain('task at open');
        expect(yield* standing).toContain(entry);
        yield* graph.act.unit(testActing, graph.act.record('answer', entry, { by: task }));
        expect(yield* (yield* BlockAnswers).answerOf(entry)).toBeNull();
        expect(yield* standing).toContain(entry);
        yield* graph.tasks.finish({ id: task });
        expect(yield* (yield* BlockAnswers).answerOf(entry)).toEqual({ kind: 'block', id: task });
        expect(yield* standing).not.toContain(entry);
      }),
    ),
  );

  it.effect('an answer names a block that was already standing; the same answer again changes nothing, another refuses', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const entry = yield* file;
        const already = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['rule'], title: 'stood before' })).id;
        const other = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['rule'], title: 'stood too' })).id;
        yield* graph.reflection.answer({ id: entry, byId: already });
        expect(yield* standing).not.toContain(entry);
        yield* graph.reflection.answer({ id: entry, byId: already });
        const answers = (yield* graph.journal.events({ blockId: entry })).filter((row) => row.op === 'answer');
        expect(answers).toHaveLength(1);
        expect((yield* demo.refusal(graph.reflection.answer({ id: entry, byId: other }))).code).toBe('already-answered');
        expect((yield* demo.refusal(graph.reflection.answer({ id: already, byId: entry }))).code).toBe('not-a-reflection');
      }),
    ),
  );

  it.effect('a dead reflection is one measured fact every surface reads', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const entry = yield* file;
        const already = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['rule'], title: 'stood before' })).id;
        yield* graph.reflection.answer({ id: entry, byId: already });
        const record = yield* graph.blocks.recordOf(yield* graph.blocks.blockById(entry));
        expect(record.answered).toBe(true);
        expect(yield* (yield* BlockAnswers).answerOf(entry)).toEqual({ kind: 'block', id: already });
        expect(yield* standing).not.toContain(entry);
        const parent = (yield* graph.blocks.blockById(entry)).parentId;
        if (parent === null) return yield* Effect.die(new Error('a filed reflection stands under its home'));
        const page = yield* graph.reading.show(parent, 1);
        expect(page.children.map((child) => child.id)).not.toContain(entry);
        const revealed = yield* graph.reading.show(parent, 1, true);
        const row = revealed.children.find((child) => child.id === entry);
        expect(row?.answered).toBe(true);
        expect(row?.answeredBy).toBe(yield* demo.nameOf(already));
        const zone = yield* graph.reading.zone(parent);
        expect(zone.page).not.toContain(`${yield* demo.nameOf(entry)} `);
        const dead = yield* graph.selection.query(projectId, {
          tags: ['reflection'],
          answered: true,
          sort: { by: 'created', order: 'desc' },
        });
        expect(dead.items.map((item) => item.name)).toContain(yield* demo.nameOf(entry));
      }),
    ),
  );
});
