import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { block, blockTag } from '../store/tables.js';
import { coreNames } from './coreNames.js';

layer(demoGraphLayer(), { excludeTestServices: true })('core names', (it) => {
  it.effect('installed types, custom inheritance, saved selections and creation defaults survive the namespace move once', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const reflection = yield* graph.blocks.create({
          projectId,
          contract: 'core/reflection',
          title: 'Lode lode/law',
          body: 'Lode lode/law is user prose.',
          fields: { command: 'shipped:lode/reflection', expected: 'an answer', actual: 'a refusal' },
        });
        const custom = yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: 'custom observation',
          fields: { id: 'sighting', extends: 'shipped:core/reflection', fields: { contract: 'string' } },
        });
        const sighting = yield* graph.blocks.create({
          projectId,
          tags: ['sighting'],
          title: 'custom observation',
          fields: { contract: 'lode/example', command: 'read', expected: 'an answer', actual: 'a refusal' },
        });
        const saved = yield* graph.blocks.create({
          projectId,
          contract: 'core/selection',
          title: 'saved observations',
          fields: {
            query: {
              tags: ['shipped:core/reflection'],
              withoutAnchorPaths: ['shipped:lode/reflection'],
              sort: { by: 'created', order: 'asc' },
            },
          },
        });
        const savedName = yield* demo.nameOf(saved.id);
        const proposal = yield* graph.blocks.create({
          projectId,
          contract: 'core/amendment',
          amendsId: (yield* graph.blocks.rootBlockOf(projectId)).id,
          title: 'deferred creation',
          fields: {
            ops: [
              {
                op: 'create',
                contract: 'core/selection',
                title: 'shipped:lode/view',
                body: 'lode/law',
                fields: {
                  query: { tags: ['shipped:core/reflection'], anchorPaths: ['shipped:lode/view'], sort: { by: 'created', order: 'asc' } },
                },
              },
              {
                op: 'update',
                id: savedName,
                fields: {
                  query: {
                    selector: { kind: 'supports', contract: 'core/observation' },
                    anchorPaths: ['shipped:lode/view'],
                    sort: { by: 'created', order: 'asc' },
                  },
                },
              },
            ],
          },
        });
        const { db } = graph.graphStore;
        const rows = yield* db.select().from(block).where(eq(block.projectId, projectId));
        for (const row of rows) {
          const fields = JSON.parse(
            JSON.stringify(row.fields).replaceAll('core/', 'lode/').replaceAll('"library":"core"', '"library":"lode"'),
          ) as Record<string, unknown>;
          const catalog = row.tags.includes('catalog') && fields.id === 'core';
          if (catalog) fields.id = 'lode';
          yield* db
            .update(block)
            .set({ fields, title: catalog ? 'lode' : row.title })
            .where(eq(block.id, row.id));
        }
        yield* db.update(blockTag).set({ typeId: sql`replace(${blockTag.typeId}, 'shipped:core/', 'shipped:lode/')` });
        yield* graph.tags.forget(projectId);
        const project = yield* graph.projects.byId(projectId);
        yield* coreNames(project);
        const table = yield* demo.table();
        expect(table.unreadable).toEqual([]);
        expect(yield* graph.blocks.blockById(reflection.id)).toMatchObject({
          title: 'Lode lode/law',
          body: 'Lode lode/law is user prose.',
          fields: { command: 'shipped:lode/reflection' },
        });
        expect((yield* graph.blocks.blockById(sighting.id)).fields.contract).toBe('lode/example');
        expect((yield* graph.blocks.blockById(saved.id)).fields.query).toMatchObject({ withoutAnchorPaths: ['shipped:lode/reflection'] });
        expect((yield* graph.blocks.blockById(proposal.id)).fields.ops).toEqual([
          {
            op: 'create',
            contract: 'core/selection',
            title: 'shipped:lode/view',
            body: 'lode/law',
            fields: {
              query: { tags: ['shipped:core/reflection'], anchorPaths: ['shipped:lode/view'], sort: { by: 'created', order: 'asc' } },
            },
          },
          {
            op: 'update',
            id: savedName,
            fields: {
              query: {
                selector: { kind: 'supports', contract: 'core/observation' },
                anchorPaths: ['shipped:lode/view'],
                sort: { by: 'created', order: 'asc' },
              },
            },
          },
        ]);
        expect(table.identities.typeOf('reflection')?.id).toBe('shipped:core/reflection');
        expect(table.supports({ tags: ['sighting'] }, 'core/observation')).toBe(true);
        expect((yield* graph.blocks.blockById(custom.id)).fields.extends).toBe('shipped:core/reflection');
        expect((yield* graph.reading.show(saved.id, 0)).results?.items.map((row) => row.name)).toEqual([yield* demo.nameOf(reflection.id)]);
        expect(
          (yield* graph.blocks.create({
            projectId,
            contract: 'core/selection',
            title: 'another saved selection',
            fields: { query: { tags: ['shipped:core/reflection'], sort: { by: 'created', order: 'asc' } } },
          })).tags,
        ).toEqual(['view']);
        const once = yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id);
        yield* coreNames(project);
        expect(yield* db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id)).toEqual(once);
      }),
    ),
  );
});
