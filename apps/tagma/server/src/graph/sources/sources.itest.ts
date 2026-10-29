import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import type { SourceKind } from '../contract/wire/sources.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('source placement', (it) => {
  it.effect('a source kind outside the reader vocabulary is refused at placement', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'foreign source kind' });
        const refused = yield* refusal(graph.sources.attach({ blockId: id, kind: 'fil' as SourceKind, ref: 'owned.ts' }));
        expect(refused.code).toBe('illegal-kind');
      }),
    ),
  );

  it.effect('a tag that binds no source kind refuses a source, while the untagged project root takes one', () =>
    withDemo(({ graph, projectId, refusal, root: home }) =>
      Effect.gen(function* () {
        const view = yield* graph.blocks.create({
          projectId,
          parentId: home,
          tags: ['view'],
          title: 'a slice',
          fields: { query: { sort: { by: 'updated', order: 'desc' } } },
        });
        const unanchorable = yield* refusal(graph.sources.attach({ blockId: view.id, kind: 'file', ref: 'owned.ts' }));
        expect(unanchorable.code).toBe('not-measurable');
        expect(unanchorable.reason).toContain('#view');
        const root = yield* graph.blocks.rootBlockOf(projectId);
        yield* graph.sources.attach({ blockId: root.id, kind: 'dir', ref: '.' });
        expect((yield* graph.sources.ownersOf(projectId, 'owned.ts')).map((row) => row.id)).toEqual([root.id]);
      }),
    ),
  );
});
