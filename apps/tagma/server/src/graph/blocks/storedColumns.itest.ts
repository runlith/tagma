import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('stored block columns', (it) => {
  it.effect('a stored tags or fields column of the wrong shape is refused at the read, never handed on mistyped', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'stored', body: 'shape' });
        yield* graph.graphStore.db.run(sql`update block set tags = '{"a":1}' where id = ${id}`);
        expect((yield* Effect.exit(graph.blocks.blockById(id)))._tag).toBe('Failure');
        yield* graph.graphStore.db.run(sql`update block set tags = '["claim"]', fields = '[1]' where id = ${id}`);
        expect((yield* Effect.exit(graph.blocks.blockById(id)))._tag).toBe('Failure');
      }),
    ),
  );
});
