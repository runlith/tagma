import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

layer(demoGraphLayer(), { excludeTestServices: true })('subtypes', (it) => {
  it.effect('subtypes inherit carrier validation and refuse a field retype or an undeclared base', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const declare = (id: string, fields: Record<string, unknown>) =>
          graph.blocks.create({ projectId, tags: ['tag'], title: `#${id}`, body: `A #${id}.`, fields: { id, ...fields } });
        yield* declare('finding', {
          fields: { severity: { type: 'enum', values: ['low', 'high'] } },
          gates: [{ gate: 'required', field: 'severity' }],
        });
        expect((yield* refusal(declare('defect', { extends: 'finding', fields: { severity: 'number' } }))).code).toBe('tag-incoherent');
        expect((yield* refusal(declare('orphan', { extends: 'nothing' }))).code).toBe('tag-incoherent');
        yield* declare('defect', { extends: 'finding', fields: { component: 'string' } });
        expect(
          (yield* refusal(graph.blocks.create({ projectId, tags: ['defect'], title: 'unsized', fields: { component: 'ui' } }))).code,
        ).toBe('field-required');
        expect(
          (yield* refusal(
            graph.blocks.create({ projectId, tags: ['defect'], title: 'mis-sized', fields: { severity: 'huge', component: 'ui' } }),
          )).code,
        ).toBe('field-invalid');
        const carrier = yield* graph.blocks.create({
          projectId,
          tags: ['defect'],
          title: 'sized',
          fields: { severity: 'high', component: 'ui' },
        });
        expect((yield* graph.blocks.blockById(carrier.id)).fields).toEqual({ severity: 'high', component: 'ui' });
      }),
    ),
  );
});
