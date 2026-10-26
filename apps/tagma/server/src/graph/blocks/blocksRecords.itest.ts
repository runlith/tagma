import { Effect, Schema } from 'effect';
import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { batchDocument } from '../contract/wire/batch.js';
import { blockCreateSchema } from '../contract/wire/creation.js';
import { type BlockQuery } from '../contract/wire/query.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

const slice: BlockQuery = { tags: ['task'], sort: { by: 'created', order: 'asc' } };
const facts = { command: 'tagma supersede L-1 --with L-2', expected: 'one act', actual: 'a delete and a retype' };
const source = { name: 'codex', ref: '.external/codex@ab12cd3' };

layer(demoGraphLayer(), { excludeTestServices: true })('record blocks', (it) => {
  it.effect('a view holds no children, and every door that names a parent says so', () =>
    withDemo(({ graph, projectId, nameOf, refusal }) =>
      Effect.gen(function* () {
        const { id: saved } = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'open tasks', fields: { query: slice } });
        expect((yield* refusal(graph.blocks.create({ projectId, tags: ['task'], title: 'under', parentId: saved }))).code).toBe('leaf');
        const loose = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'loose' });
        expect((yield* refusal(graph.blocks.update({ id: loose.id, parentId: saved }))).code).toBe('leaf');
        const name = yield* nameOf(saved);
        const batched = yield* refusal(
          graph.batch.apply(batchDocument([{ op: 'create', tags: ['task'], title: 'batched', parentId: name }]), projectId),
        );
        expect(batched.code).toBe('leaf');
        const filed = yield* refusal(
          graph.batch.apply(
            batchDocument([
              {
                op: 'propose',
                amendsId: name,
                title: 'a finding',
                ops: [{ op: 'create', tags: ['task'], title: 'proposed', parentId: name }],
              },
            ]),
            projectId,
          ),
        );
        expect(filed.code).toBe('leaf');
        const amendment = yield* graph.batch.apply(
          batchDocument([
            {
              op: 'propose',
              amendsId: name,
              title: 'the slice is too wide',
              ops: [{ op: 'update', id: name, title: 'open tasks of this area' }],
            },
          ]),
          projectId,
        );
        const proposalId = (amendment.ops[0] as { id: number }).id;
        expect((yield* graph.reading.show(saved, 1)).children.map((child) => child.id)).toEqual([proposalId]);
      }),
    ),
  );

  it.effect('a view names a selection, not a place in the code, so it takes no source', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const saved = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'open tasks', fields: { query: slice } });
        const refused = yield* refusal(
          graph.sources.attach({ blockId: saved.id, kind: 'file', ref: 'apps/tagma/server/src/graph/Graph.ts' }),
        );
        expect(refused.code).toBe('not-measurable');
      }),
    ),
  );

  it.effect('opening a view runs it: the page stands beside the children, never among them', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const first = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'first' });
        const second = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'second' });
        const saved = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'open tasks', fields: { query: slice } });
        const opened = yield* graph.reading.show(saved.id, 1);
        expect(opened.children).toEqual([]);
        expect(opened.results?.items.map((row) => row.name)).toEqual([yield* nameOf(first.id), yield* nameOf(second.id)]);
        expect(opened.results?.total).toBe(2);
        const root = yield* graph.blocks.rootBlockOf(projectId);
        const above = yield* graph.reading.show(root.id, 2);
        expect(above.children.find((child) => child.id === saved.id)?.results).toBeNull();
      }),
    ),
  );

  it.effect('a saved query that no longer fits the schema refuses on read', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const saved = yield* graph.blocks.create({ projectId, tags: ['view'], title: 'open tasks', fields: { query: slice } });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { query: { tags: ['task'] } } })
          .where(eq(block.id, saved.id));
        const refused = yield* refusal(graph.reading.show(saved.id, 1));
        expect(refused.code).toBe('field-invalid');
        expect(refused.reason).toContain('sort');
      }),
    ),
  );

  it.effect('a scope that no longer stands empties the page and is named back', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'zone' });
        yield* graph.blocks.create({ projectId, tags: ['task'], title: 'inside', parentId: area.id });
        const name = yield* nameOf(area.id);
        const saved = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'the zone',
          fields: { query: { ...slice, scope: [name] } },
        });
        expect((yield* graph.reading.show(saved.id, 1)).results?.total).toBe(1);
        yield* graph.trash.delete({ id: area.id });
        const opened = (yield* graph.reading.show(saved.id, 1)).results;
        expect(opened?.items).toEqual([]);
        expect(opened?.total).toBe(0);
        expect(opened?.missingScope).toEqual([name]);
      }),
    ),
  );

  it.effect('rewriting the query journals the fields it replaced and keeps the layout', () =>
    withDemo(({ graph, projectId, table, refusal }) =>
      Effect.gen(function* () {
        const saved = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'open tasks',
          fields: { query: slice, layout: { mode: 'board', by: 'status' } },
        });
        yield* graph.blocks.update({ id: saved.id, fields: { query: { tags: ['spec'], sort: { by: 'created', order: 'asc' } } } });
        const [entry] = (yield* graph.journal.events({ blockId: saved.id })).filter((row) => row.op === 'update');
        expect(entry).toBeDefined();
        const taskId = (yield* table()).identities.typeOf('task')?.id;
        if (taskId === undefined) return yield* Effect.die('#task is not installed');
        expect((JSON.parse(entry?.payload ?? '{}') as { wasFields?: { query?: BlockQuery } }).wasFields?.query).toEqual({
          ...slice,
          tags: [taskId],
        });
        expect((yield* graph.blocks.blockById(saved.id)).fields).toMatchObject({ layout: { mode: 'board', by: 'status' } });
        const plain = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'plain' });
        expect((yield* refusal(graph.blocks.update({ id: plain.id, fields: { query: slice } }))).code).toBe('field-invalid');
      }),
    ),
  );

  it.effect('records persist their facts, and corrections journal what they replaced', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const filed = yield* graph.blocks.create({ projectId, tags: ['reflection'], title: 'friction', fields: facts });
        expect((yield* graph.blocks.blockById(filed.id)).fields).toEqual(facts);
        const corrected = { ...facts, actual: 'a delete and a retype, and the name is lost with it' };
        yield* graph.blocks.update({ id: filed.id, fields: corrected });
        expect((yield* graph.blocks.blockById(filed.id)).fields).toEqual(corrected);
        const [entry] = (yield* graph.journal.events({ blockId: filed.id })).filter((row) => row.op === 'update');
        expect((JSON.parse(entry?.payload ?? '{}') as { wasFields?: { actual?: string } }).wasFields).toEqual({ actual: facts.actual });
        const read = yield* graph.blocks.create({ projectId, tags: ['research'], title: 'how codex resumes', fields: { source } });
        expect((yield* graph.blocks.blockById(read.id)).fields).toEqual({ source });
        yield* graph.blocks.update({ id: read.id, fields: { source: { name: 'codex', ref: '.external/codex@ff00aa1' } } });
        expect((yield* graph.blocks.blockById(read.id)).fields).toEqual({ source: { name: 'codex', ref: '.external/codex@ff00aa1' } });
        const plain = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'plain' });
        expect((yield* refusal(graph.blocks.update({ id: plain.id, fields: facts }))).code).toBe('field-invalid');
      }),
    ),
  );

  it.effect('a create missing its tag’s own half refuses at the gate, naming the field', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const core = { projectId, title: 'x' };
        for (const [input, code] of [
          [{ ...core, tags: ['view'] }, 'field-required'],
          [{ ...core, tags: ['reflection'] }, 'field-required'],
          [{ ...core, tags: ['reflection'], fields: { ...facts, actual: '  ' } }, 'field-invalid'],
          [{ ...core, tags: ['research'] }, 'field-required'],
          [{ ...core, tags: ['research'], fields: { source: { name: 'codex' } } }, 'field-invalid'],
          [{ ...core, tags: ['proposal'] }, 'field-required'],
          [{ ...core, tags: ['proposal'], fields: { ops: [{ op: 'create', title: 'child' }] } }, 'amends-missing'],
          [{ ...core, tags: ['invoice'] }, 'tag-undeclared'],
        ] as const)
          expect((yield* refusal(graph.blocks.create(input))).code).toBe(code);
        const born = yield* graph.blocks.create({ ...core, tags: ['idea'] });
        expect((yield* refusal(graph.blocks.create({ ...core, tags: ['idea'], amendsId: born.id }))).code).toBe('amends-shape');
      }),
    ),
  );

  it.effect('research takes no source, at birth and afterwards', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const born = yield* refusal(
          graph.blocks.create({
            projectId,
            tags: ['research'],
            title: 'how codex resumes',
            fields: { source },
            sources: [{ kind: 'file', ref: 'apps/tagma/server/src/graph/Graph.ts' }],
          }),
        );
        expect(born.code).toBe('not-measurable');
        const read = yield* graph.blocks.create({ projectId, tags: ['research'], title: 'how codex streams', fields: { source } });
        const later = yield* refusal(graph.sources.attach({ blockId: read.id, kind: 'file', ref: 'apps/tagma/server/src/graph/Graph.ts' }));
        expect(later.code).toBe('not-measurable');
      }),
    ),
  );

  it.effect('a stored record that no longer fits is refused by the write, not the read', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const filed = yield* graph.blocks.create({ projectId, tags: ['reflection'], title: 'friction', fields: facts });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { command: 'tagma x', expected: 'one act' } })
          .where(eq(block.id, filed.id));
        expect((yield* graph.blocks.blockById(filed.id)).fields).toEqual({ command: 'tagma x', expected: 'one act' });
        const refused = yield* refusal(graph.blocks.update({ id: filed.id, fields: { command: 'tagma y' } }));
        expect(refused.code).toBe('field-required');
        expect(refused.reason).toContain('actual');
      }),
    ),
  );

  it.effect('a stored document that no longer fits refuses the acts that read it and rolls them back', () =>
    withDemo(({ graph, projectId, nameOf, refusal }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'target', body: 'before' });
        const saved = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'view',
          fields: { query: { sort: { by: 'updated', order: 'desc' } } },
        });
        const filed = yield* graph.review.propose({
          projectId,
          amendsId: target.id,
          title: 'proposal',
          ops: [{ op: 'edit', id: yield* nameOf(target.id), old: 'before', new: 'after' }],
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { query: { tags: ['task'] } } })
          .where(eq(block.id, saved.id));
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { status: 'open', ops: [] } })
          .where(eq(block.id, filed.id));
        const before = yield* graph.blocks.blockById(saved.id);
        const journal = yield* graph.journal.events({ blockId: saved.id });
        expect((yield* refusal(graph.reading.show(saved.id, 0))).code).toBe('field-invalid');
        expect((yield* refusal(graph.blocks.update({ id: saved.id, fields: { query: { tags: ['task'] } } }))).code).toBe('field-invalid');
        expect(yield* graph.blocks.blockById(saved.id)).toEqual(before);
        expect(yield* graph.journal.events({ blockId: saved.id })).toEqual(journal);
        const filedBefore = yield* graph.blocks.blockById(filed.id);
        const filedJournal = yield* graph.journal.events({ blockId: filed.id });
        expect((yield* refusal(graph.review.accept({ id: filed.id }))).code).toBe('field-invalid');
        expect((yield* graph.review.obstacles(filed.id)).length).toBeGreaterThan(0);
        expect(yield* graph.blocks.blockById(filed.id)).toEqual(filedBefore);
        expect(yield* graph.journal.events({ blockId: filed.id })).toEqual(filedJournal);
      }),
    ),
  );

  it.effect('a page above a view whose selection no longer fits still reads, and the view refuses where it is opened', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const parent = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'parent', body: 'visible body' });
        const child = yield* graph.blocks.create({
          projectId,
          parentId: parent.id,
          tags: ['view'],
          title: 'child',
          fields: { query: { sort: { by: 'updated', order: 'desc' } } },
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { query: { tags: ['task'] } } })
          .where(eq(block.id, child.id));
        expect(yield* graph.reading.show(parent.id, 0)).toMatchObject({ id: parent.id, body: 'visible body', children: [] });
        expect((yield* graph.reading.show(parent.id, 1)).children.map((row) => row.id)).toEqual([child.id]);
        expect((yield* refusal(graph.reading.show(child.id, 1))).code).toBe('field-invalid');
      }),
    ),
  );
});

test('the create input refuses an empty tag', () => {
  expect(Schema.decodeUnknownResult(blockCreateSchema)({ projectId: 1, title: 'x', tags: [''] })._tag).toBe('Failure');
});
