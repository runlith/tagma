import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { block as blockRow } from '../store/tables.js';
import { batchDocument } from '../contract/wire/batch.js';
import { SHIPPED_CATALOGS } from '../../composition/testing/settings.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const BODY_CAP = 32;

const withBounded = <A, E, R>(body: (demo: EffectDemo) => Effect.Effect<A, E, R>) =>
  withDemo((demo) =>
    Effect.flatMap(
      demo.graph.blocks.create({
        projectId: demo.projectId,
        tags: ['tag'],
        title: '#bounded',
        fields: { id: 'bounded', body: { shape: 'content', cap: BODY_CAP } },
      }),
      () => body(demo),
    ),
  );

layer(demoGraphLayer(), { excludeTestServices: true })('body law', (it) => {
  it.effect('uncapped rules, specs and decisions preserve complete bodies', () =>
    withDemo(({ graph, projectId, fixture }) =>
      Effect.gen(function* () {
        const body = 'x'.repeat(20_000);
        for (const tag of ['rule', 'spec']) {
          const written = yield* graph.blocks.create({ projectId, tags: [tag], title: 'the contract', body });
          expect(written.body).toBe(body);
        }
        const titleOnly = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Do not log secrets' });
        expect(titleOnly.body).toBe('');
        yield* graph.settings.write({ scope: 'user', key: SHIPPED_CATALOGS.key.id, value: ['knowledge'] });
        const notebook = yield* graph.projectLifecycle.create({ name: 'notebook', rootPath: yield* fixture.directory('knowledge-body') });
        const reasons = 'x'.repeat(6_000);
        const decision = yield* graph.blocks.create({ projectId: notebook.id, tags: ['decision'], title: 'the choice', body: reasons });
        expect(decision.body).toBe(reasons);
      }),
    ),
  );

  it.effect('an explicit cap applies to creation and updates, and a body already over it may shrink but not grow', () =>
    withBounded(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const body = 'x'.repeat(BODY_CAP);
        const written = yield* graph.blocks.create({ projectId, tags: ['bounded'], title: 'bounded data', body });
        expect(written.body).toBe(body);
        expect((yield* refusal(graph.blocks.update({ id: written.id, body: `${body}x` }))).code).toBe('body-capped');
        expect((yield* refusal(graph.blocks.create({ projectId, tags: ['bounded'], title: 'too large', body: `${body}x` }))).code).toBe(
          'body-capped',
        );
        expect((yield* graph.blocks.blockById(written.id)).body).toBe(body);
        const over = 'x'.repeat(BODY_CAP + 200);
        yield* graph.graphStore.db.update(blockRow).set({ body: over }).where(eq(blockRow.id, written.id));
        const shrunk = yield* graph.blocks.update({ id: written.id, body: over.slice(0, -100) });
        expect(shrunk.body).toBe(over.slice(0, -100));
        expect((yield* refusal(graph.blocks.update({ id: written.id, body: `${over}xx` }))).code).toBe('body-capped');
      }),
    ),
  );

  it.effect('batch cap checks include expanded handles and roll the whole document back', () =>
    withBounded(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const refused = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['idea'], title: 'rollbackwitness lands only with its document' },
              { op: 'create', tags: ['bounded'], title: 'bounded data', body: 'x'.repeat(BODY_CAP + 1) },
            ]),
            projectId,
          ),
        );
        expect(refused.code).toBe('body-capped');
        expect((yield* graph.ranking.search({ projectId, query: 'rollbackwitness' })).items).toEqual([]);
        const fits = `${'x'.repeat(BODY_CAP - 9)}[[$h]]`;
        const expanded = yield* refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', $id: 'h', tags: ['idea'], title: 'the handle the body names' },
              { op: 'create', tags: ['bounded'], title: 'bounded data', body: fits },
            ]),
            projectId,
          ),
        );
        expect(expanded.code).toBe('body-capped');
        expect((yield* graph.ranking.search({ projectId, query: 'the handle the body names' })).items).toEqual([]);
      }),
    ),
  );
});
