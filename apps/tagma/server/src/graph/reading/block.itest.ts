import { Effect, Tracer } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('block pages', (it) => {
  it.effect('a block page names what its body points at in GLOBAL', () =>
    withDemo(({ graph, projectId, nameOf, root: home }) =>
      Effect.gen(function* () {
        const global = yield* graph.projects.global();
        const globalRoot = yield* graph.blocks.rootBlockOf((global as { id: number }).id);
        const law = yield* graph.blocks.create({
          projectId: (global as { id: number }).id,
          parentId: globalRoot.id,
          tags: ['rule'],
          title: 'the law',
        });
        const name = yield* nameOf(law.id);
        const doc = yield* graph.blocks.create({
          projectId,
          parentId: home,
          tags: ['idea'],
          title: 'what we stand on',
          body: `We stand on [[${name}]].`,
        });
        expect((yield* graph.reading.show(doc.id, 0)).refsOut).toEqual([name]);
      }),
    ),
  );

  it.effect('a page never crosses a name two of its own blocks answer', () =>
    withDemo(({ graph, projectId, root: home }) =>
      Effect.gen(function* () {
        const global = yield* graph.projects.global();
        const named = Effect.fnUntraced(function* (uuid: string, owner: number, title: string) {
          const { id } = yield* graph.blocks.create({
            projectId: owner,
            parentId: (yield* graph.blocks.rootBlockOf(owner)).id,
            tags: ['idea'],
            title,
          });
          yield* graph.graphStore.db.update(block).set({ uuid }).where(eq(block.id, id));
        });
        yield* named('00000000-0000-4000-8000-0001beeff00d', projectId, 'one of two');
        yield* named('00000000-0000-4000-8000-0002beeff00d', projectId, 'two of two');
        yield* named('00000000-0000-4000-8000-0003beeff00d', (global as { id: number }).id, 'the law');
        const doc = yield* graph.blocks.create({
          projectId,
          parentId: home,
          tags: ['idea'],
          title: 'points at a collision',
          body: 'see [[beeff00d]]',
        });
        expect((yield* graph.reading.show(doc.id, 0)).refsOut).toEqual([]);
      }),
    ),
  );

  it.effect('outline depth counts standing ancestors and keeps promoted siblings in outline order', () =>
    withDemo(({ graph, projectId, root: home }) =>
      Effect.gen(function* () {
        const create = (title: string, parentId?: number, tags?: string[]) =>
          Effect.map(graph.blocks.create({ projectId, title, parentId: parentId ?? home, tags }), (row) => row.id);
        const root = yield* create('root');
        const closed = yield* create('closed', root, ['idea']);
        const promoted = yield* create('promoted', closed);
        const deep = yield* create('deep', promoted);
        const retired = yield* create('retired', root);
        const lifted = yield* create('lifted', retired);
        const sibling = yield* create('sibling', root);
        yield* graph.tasks.close({ id: closed });
        yield* graph.standing.supersede({ oldId: retired, withId: sibling });
        const outline = yield* graph.selection.outline(root, 1, false);
        expect(outline.rows.map((row) => row.id).sort()).toEqual([root, promoted, lifted, sibling].sort());
        const page = yield* graph.reading.show(root, 1);
        expect(page.children.map((row) => row.id)).toEqual([promoted, lifted, sibling]);
        expect(page.children[0]?.children).toEqual([]);
        expect(page.shape).toEqual({ blocks: 5, depth: 3, widest: 3 });
        expect(page.children[0]?.shape).toEqual({ blocks: 1, depth: 1, widest: 1 });
        expect((yield* graph.reading.show(root, 2)).children[0]?.children.map((row) => row.id)).toEqual([deep]);
        expect((yield* graph.selection.outline(root, 0, false)).rows.map((row) => row.id)).toEqual([root]);
        const history = yield* graph.reading.show(root, 1, true);
        expect(history.children.map((row) => row.id)).toEqual([closed, retired, sibling]);
        expect(history.children[1]?.shape).toEqual({ blocks: 0, depth: 0, widest: 0 });
        expect((yield* graph.reading.show(retired, 1)).children.map((row) => row.id)).toEqual([lifted]);
      }),
    ),
  );

  it.effect('block detail SQL count is independent of visible child count', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'area' });
        const child = (title: string) => graph.blocks.create({ projectId, parentId: area.id, tags: ['idea'], title });
        yield* child('first');
        const sqlCount = Effect.fnUntraced(function* () {
          const spans: Tracer.NativeSpan[] = [];
          const tracer = Tracer.make({
            span: (options) => {
              const span = new Tracer.NativeSpan(options);
              spans.push(span);
              return span;
            },
          });
          yield* graph.reading.show(area.id, 1).pipe(Effect.withTracer(tracer));
          return spans.filter((span) => span.name === 'sql.execute').length;
        });
        const one = yield* sqlCount();
        for (const title of ['second', 'third', 'fourth', 'fifth']) yield* child(title);
        expect(yield* sqlCount()).toBe(one);
      }),
    ),
  );
});
