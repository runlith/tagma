import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('a spec is edited in place', (it) => {
  it.effect('a body rewritten while its work is in flight stays the same open spec', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec' });
        const work = yield* graph.blocks.create({
          projectId,
          tags: ['task'],
          title: 'build',
          edges: [{ kind: 'implements', to: spec.id }],
        });
        yield* graph.tasks.claim({ id: work.id });
        yield* graph.blocks.update({ id: spec.id, body: 'What is wanted now.' });
        const edited = yield* graph.reading.show(spec.id, 0);
        expect(edited.body).toBe('What is wanted now.');
        expect((yield* table()).statusOf(edited)).toBe('open');
      }),
    ),
  );

  it.effect('close_block closes a spec whose child specs nobody checked', () =>
    withDemo(({ graph, projectId, table }) =>
      Effect.gen(function* () {
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec' });
        yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'unchecked part', parentId: spec.id });
        yield* graph.tasks.close({ id: spec.id, reason: 'done elsewhere' });
        expect((yield* table()).statusOf(yield* graph.reading.show(spec.id, 0))).toBe('closed');
      }),
    ),
  );
});
