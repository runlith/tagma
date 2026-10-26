import { performance } from 'node:perf_hooks';
import { Effect, Tracer } from 'effect';
import { eq } from 'drizzle-orm';
import { graphFixture } from '../src/composition/testing/graphFixture.js';
import { block } from '../src/graph/store/tables.js';
import { mintBlockId } from '../src/graph/contract/wire/identity.js';
import { projectDelta, projectToTree } from '../src/graph/tree/projection.js';

const world = graphFixture();
const demo = await Effect.runPromise(world.openEffect());
const { graph, projectId } = demo;
const run = Effect.runPromiseWith(demo.context);
const sample = async (name: string, work: () => Promise<unknown>) => {
  await work();
  const elapsed: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    await work();
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, samples: elapsed, medianMs: elapsed[2] }));
};
try {
  const root = (await run(graph.blocks.create({ projectId, title: 'Bench' }))).id;
  const body = 'Benchmark payload contains ordinary searchable words. '.repeat(80);
  const now = new Date();
  const branches = await run(
    graph.graphStore.db
      .insert(block)
      .values(
        Array.from({ length: 10 }, (_, index) => ({
          uuid: mintBlockId(),
          projectId,
          parentId: root,
          ord: index + 1,
          title: `Branch ${index}`,
          body,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning({ id: block.id }),
  );
  for (const branch of branches) {
    await run(
      graph.graphStore.db.insert(block).values(
        Array.from({ length: 100 }, (_, index) => ({
          uuid: mintBlockId(),
          projectId,
          parentId: branch.id,
          ord: index + 1,
          title: `Leaf ${index}`,
          body,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }
  console.log(JSON.stringify({ blocks: 1011, bodyBytes: body.length * 1010, warmup: 1, samples: 5, workers: 1 }));
  await sample('read depth 1', () => run(graph.reading.show(root, 1)));
  const outline = await run(graph.selection.outline(root, 1, false));
  console.log(
    JSON.stringify({
      outlineRows: outline.rows.length,
      outlineBodyBytes: outline.rows.reduce((sum, row) => sum + row.body.length, 0),
      shape: outline.shapes.get(root),
    }),
  );
  const treeRoot = await run(demo.fixture.directory('bench-tree'));
  await run(projectToTree({ projectId, treeRoot }));
  const leaf = await run(graph.graphStore.db.select({ id: block.id }).from(block).where(eq(block.parentId, branches[0]!.id)).limit(1));
  await sample('project one leaf', () => run(projectDelta({ projectId, treeRoot, blockIds: [leaf[0]!.id] })));
  let ord = 1000;
  await sample('update ord', () => run(graph.blocks.update({ id: leaf[0]!.id, ord: ord++ })));
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  await run(graph.blocks.update({ id: leaf[0]!.id, ord: ord++ }).pipe(Effect.withTracer(tracer)));
  console.log(
    JSON.stringify({
      updateSearchQueries: spans.filter(
        (span) => span.name === 'sql.execute' && String(span.attributes.get('db.query.summary')).includes('search_index'),
      ).length,
    }),
  );
} finally {
  await Effect.runPromise(world.releaseEffect);
}
