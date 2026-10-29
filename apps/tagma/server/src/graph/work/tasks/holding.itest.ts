import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../../../composition/testing/graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('claim and release', (it) => {
  it.effect('a holder claiming again keeps its task, and another session takes it over only from the holder it agreed to', () =>
    withDemo(({ graph, projectId, as, refusal, table, root }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'task' });
        const agreed = tags.holderOf(yield* graph.blocks.blockById(id));
        const first = yield* as('a', graph.tasks.claim({ id }));
        expect(tags.holderOf(yield* as('a', graph.tasks.claim({ id })))).toBe(tags.holderOf(first));
        expect((yield* refusal(as('b', graph.tasks.claim({ id, over: agreed })))).code).toBe('claimed-elsewhere');
        expect(tags.holderOf(yield* graph.blocks.blockById(id))).toBe(tags.holderOf(first));
        const taken = yield* as('b', graph.tasks.claim({ id, over: tags.holderOf(first) }));
        expect(tags.statusOf(taken)).toBe('in_work');
        expect(tags.holderOf(taken)).not.toBeNull();
        expect(tags.holderOf(taken)).not.toBe(tags.holderOf(first));
        expect(yield* as('b', graph.tasks.heldElsewhere(yield* graph.blocks.blockById(id)))).toBeNull();
      }),
    ),
  );

  it.effect('release returns the task to the pool and drops the assignee together', () =>
    withDemo(({ graph, projectId, as, table, root }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'task' });
        yield* graph.tasks.claim({ id });
        const released = yield* graph.tasks.release({ id });
        expect(tags.statusOf(released)).toBe('open');
        expect(tags.holderOf(released)).toBeNull();
        expect((yield* graph.selection.ready({ projectId })).map((row) => row.id)).toContain(id);
        expect(tags.holderOf(yield* as('b', graph.tasks.claim({ id })))).not.toBeNull();
      }),
    ),
  );

  it.effect('a task nobody holds is not released', () =>
    withDemo(({ graph, projectId, refusal, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'task' });
        expect((yield* refusal(graph.tasks.release({ id }))).code).toBe('not-held');
      }),
    ),
  );

  it.effect('open is the release verb’s word, and in_work is the claim verb’s word', () =>
    withDemo(({ graph, projectId, as, refusal, table, root }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'task' });
        expect((yield* refusal(graph.blocks.update({ id, status: 'in_work' }))).code).toBe('status-operation');
        expect(tags.holderOf(yield* graph.blocks.blockById(id))).toBeNull();
        const held = yield* as('a', graph.tasks.claim({ id }));
        expect((yield* refusal(graph.blocks.update({ id, status: 'open' }))).code).toBe('status-operation');
        const after = yield* graph.blocks.blockById(id);
        expect(tags.statusOf(after)).toBe('in_work');
        expect(tags.holderOf(after)).toBe(tags.holderOf(held));
      }),
    ),
  );
});
