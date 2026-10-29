import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('trash', (it) => {
  it.effect('delete hides the subtree from live reads; restore brings the batch back', () =>
    withDemo(({ graph, projectId, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        const parent = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'p', parentId: root });
        const child = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'c', parentId: parent.id });
        const names = [yield* nameOf(parent.id), yield* nameOf(child.id)] as const;
        yield* graph.trash.delete({ id: parent.id });
        expect((yield* graph.ranking.search({ query: '', projectId })).items.some((row) => names.includes(row.name))).toBe(false);
        expect((yield* graph.selection.ready({ projectId })).some((row) => row.id === parent.id)).toBe(false);
        expect((yield* refusal(graph.blocks.blockById(parent.id))).code).toBe('deleted');
        expect((yield* graph.trash.roots(projectId)).map((row) => row.id)).toEqual([parent.id]);
        yield* graph.trash.restore({ id: parent.id });
        const restored = (yield* graph.ranking.search({ query: '', projectId })).items.map((row) => row.name);
        expect(restored).toContain(names[0]);
        expect(restored).toContain(names[1]);
      }),
    ),
  );

  it.effect('a deleted blocker stops blocking; a separately trashed child stays trashed', () =>
    withDemo(({ graph, projectId, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        const blocker = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'blocker', parentId: root });
        const dependent = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'dependent', parentId: root });
        yield* graph.edges.link({ fromId: dependent.id, kind: 'waits-on', toId: blocker.id });
        expect((yield* graph.selection.ready({ projectId })).map((row) => row.id)).not.toContain(dependent.id);
        yield* graph.trash.delete({ id: blocker.id });
        expect((yield* graph.selection.ready({ projectId })).map((row) => row.id)).toContain(dependent.id);
        const parent = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'p2', parentId: root });
        const child = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'c2', parentId: parent.id });
        yield* graph.trash.delete({ id: child.id });
        yield* graph.trash.delete({ id: parent.id });
        const orphaned = yield* refusal(graph.trash.restore({ id: child.id }));
        expect([orphaned.code, orphaned.unblock]).toEqual(['parent-deleted', [`restore_block ${yield* nameOf(parent.id)}`]]);
        yield* graph.trash.restore({ id: parent.id });
        expect((yield* graph.blocks.blockById(parent.id)).deletedAt).toBeNull();
        expect((yield* refusal(graph.blocks.blockById(child.id))).code).toBe('deleted');
      }),
    ),
  );
});
