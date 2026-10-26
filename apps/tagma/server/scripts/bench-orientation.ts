import { Effect, Tracer } from 'effect';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphFixture } from '../src/composition/testing/graphFixture.js';
import { writes } from '../src/platform/contract/service/writes.js';
import { block } from '../src/graph/store/tables.js';
import { projecting, referencing } from '../src/graph/store/actWrites.js';

const world = graphFixture();
const demo = await Effect.runPromise(world.openEffect());
const { graph, projectId } = demo;
const run = Effect.runPromiseWith(demo.context);
const counts = new Map<string, number>();
const tracer = Tracer.make({
  span(options) {
    counts.set(options.name, (counts.get(options.name) ?? 0) + 1);
    return new Tracer.NativeSpan(options);
  },
});
const sample = async (name: string, work: () => Effect.Effect<unknown, unknown>) => {
  counts.clear();
  const cold = performance.now();
  await run(work().pipe(Effect.withTracer(tracer)));
  const coldMs = performance.now() - cold;
  const coldSpans = Object.fromEntries(counts);
  counts.clear();
  const elapsed: number[] = [];
  for (let at = 0; at < 15; at += 1) {
    const start = performance.now();
    await run(work().pipe(Effect.withTracer(tracer)));
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, coldMs, coldSpans, medianMs: elapsed[7], maxMs: elapsed[14], spans: Object.fromEntries(counts) }));
};
try {
  mkdirSync(join(demo.demoRoot, 'src'), { recursive: true });
  writeFileSync(join(demo.demoRoot, 'src', 'sample.ts'), 'export const sample = 1;\n');
  const parent = (await run(graph.blocks.rootBlockOf(projectId))).id;
  const [module] = await run(graph.blocks.writeModules(projectId, [{ id: 'bench', title: 'Bench module', parent, root: 'src' }], []));
  await run(
    graph.act.unit(
      writes('Bench.seed', [block], projecting, referencing),
      Effect.gen(function* () {
        for (let at = 0; at < 156; at += 1) {
          yield* graph.blocks.create({
            projectId,
            parentId: at % 2 === 0 ? module : parent,
            tags: ['rule'],
            title: `Rule ${at}`,
            body: 'Follow the declared contract. '.repeat(10),
          });
        }
      }),
    ),
  );
  console.log(JSON.stringify({ rules: 156, samples: 15, workers: 1, fixture: 'isolated SQLite reader pool; no running server' }));
  await sample('instructions', () => graph.orientation.instructions({ projectId, audience: 'graph' }));
  await sample('touch', () => graph.touches.touch({ projectId, shown: [{ path: 'src/sample.ts', as: 'read' }] }));
  const note = await run(graph.blocks.create({ projectId, title: 'Unrelated note' }));
  await run(graph.blocks.update({ id: note.id, body: 'Ordinary graph write.' }));
  await sample('instructions after unrelated write', () => graph.orientation.instructions({ projectId, audience: 'graph' }));
  await run(graph.projectPolicy.set({ ref: String(projectId), settings: { strictProvenance: true } }));
  await sample('instructions after policy write', () => graph.orientation.instructions({ projectId, audience: 'graph' }));
} finally {
  await Effect.runPromise(world.releaseEffect);
}
