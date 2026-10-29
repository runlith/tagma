import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writes } from '../../platform/contract/service/writes.js';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';

const testActing = writes('test', []);

const lens = ({ graph, projectId, root }: EffectDemo) => ({
  declare: (fields: Record<string, unknown>) =>
    graph.blocks.create({ projectId, tags: ['tag'], title: `#${fields.id as string}`, body: 'declared here', parentId: root, fields }),
});

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer(), { excludeTestServices: true })('tag lifetime', (it) => {
  it.effect('rolled-back declarations disappear; incompatible changes leave the standing declaration intact', () =>
    withLens(({ graph, projectId, declare, nameOf, refusal, table, root }) =>
      Effect.gen(function* () {
        const painting = yield* graph.tags.reader(projectId);
        const readItsOwn: (string | null)[] = [];
        const rolled = yield* Effect.result(
          graph.act.unit(
            testActing,
            Effect.gen(function* () {
              yield* graph.blocks.create({
                projectId,
                tags: ['tag'],
                title: '#invoice',
                body: 'declared inside an act that refuses',
                parentId: root,
                fields: { id: 'invoice', fields: { total: 'number' } },
              });
              readItsOwn.push((yield* graph.tags.of(projectId)).tagById('invoice')?.id ?? null);
              return yield* new GateRefusal('test-rollback', 'this act refuses after declaring', [
                'nothing: the case needs the act to end without committing',
              ]);
            }),
          ),
        );
        expect(rolled._tag).toBe('Failure');
        expect(readItsOwn).toEqual(['invoice']);
        expect(painting().tagById('invoice')).toBeNull();
        expect((yield* table()).tagById('invoice')).toBeNull();
        expect((yield* refusal(graph.blocks.create({ projectId, tags: ['invoice'], title: 'March', parentId: root }))).code).toBe(
          'tag-undeclared',
        );
        const declaration = yield* declare({ id: 'invoice', fields: { total: 'number' } });
        const carrier = yield* graph.blocks.create({
          projectId,
          tags: ['invoice'],
          title: 'March',
          parentId: root,
          fields: { total: 12 },
        });
        const refused = yield* refusal(graph.blocks.update({ id: declaration.id, fields: { fields: { total: 'string' } } }));
        expect(refused.code).toBe('carriers-invalid');
        expect(refused.reason).toContain(yield* nameOf(carrier.id));
        expect(refused.reason).toContain('invoice.total');
        expect((yield* table()).tagById('invoice')?.fields.total).toBe('number');
        const renamed = yield* refusal(graph.blocks.update({ id: declaration.id, fields: { id: 'bill' } }));
        expect(renamed.code).toBe('carriers-invalid');
        expect(renamed.reason).toContain('#invoice');
        expect((yield* table()).tagById('bill')).toBeNull();
      }),
    ),
  );

  it.effect('an unreadable stored declaration cannot be rewritten as if its malformed parts were absent, and can be repaired', () =>
    withLens(({ graph, declare, refusal, table }) =>
      Effect.gen(function* () {
        const declaration = yield* declare({ id: 'damaged', fields: { value: 'string' } });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { ...declaration.fields, roles: 'unreadable' } })
          .where(eq(block.id, declaration.id));
        expect((yield* refusal(graph.blocks.update({ id: declaration.id, body: 'rewritten declaration' }))).code).toBe('tag-incoherent');
        yield* graph.blocks.update({ id: declaration.id, fields: { roles: {} } });
        expect((yield* table()).tagById('damaged')?.fields.value).toBe('string');
      }),
    ),
  );

  it.effect('a declaration change that its carriers do read re-projects them, because what a seek compares is the declaration', () =>
    withLens(({ graph, projectId, declare, table, root }) =>
      Effect.gen(function* () {
        const declaration = yield* declare({ id: 'invoice', fields: { total: 'string' } });
        yield* graph.blocks.create({ projectId, tags: ['invoice'], title: 'March', parentId: root, fields: { total: 'paid in full' } });
        const seek = Effect.map(
          graph.selection.query(projectId, { fields: { total: 'paid in full' }, sort: { by: 'created', order: 'asc' } }),
          (page) => page.items.map((row) => row.title),
        );
        expect(yield* seek).toEqual(['March']);
        yield* graph.blocks.update({ id: declaration.id, fields: { fields: { total: { type: 'schema', name: 'line' } } } });
        expect((yield* table()).tagById('invoice')?.fields.total).toEqual({ type: 'schema', name: 'line' });
        expect(yield* seek).toEqual([]);
      }),
    ),
  );

  it.effect('a ref field is resolved where it is written: the name must answer, and what answers must carry the tag', () =>
    withLens(({ graph, projectId, declare, nameOf, refusal, root }) =>
      Effect.gen(function* () {
        yield* declare({ id: 'person', fields: {} });
        yield* declare({ id: 'meeting', fields: { attendees: { type: 'ref', tag: 'person', many: true } } });
        const stranger = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'not a person', parentId: root });
        const missing = yield* refusal(
          graph.blocks.create({ projectId, tags: ['meeting'], title: 'standup', parentId: root, fields: { attendees: ['deadbeef'] } }),
        );
        expect(missing.code).toBe('field-target');
        expect(missing.reason).toContain('meeting.attendees');
        const wrong = yield* refusal(
          graph.blocks.create({
            projectId,
            tags: ['meeting'],
            title: 'standup',
            parentId: root,
            fields: { attendees: [yield* nameOf(stranger.id)] },
          }),
        );
        expect(wrong.code).toBe('field-target');
        expect(wrong.reason).toContain('#person');
        const person = yield* graph.blocks.create({ projectId, tags: ['person'], title: 'Ada', parentId: root });
        const named = yield* nameOf(person.id);
        const met = yield* graph.blocks.create({
          projectId,
          tags: ['meeting'],
          title: 'standup',
          parentId: root,
          fields: { attendees: [named] },
        });
        expect(met.fields.attendees).toEqual([named]);
      }),
    ),
  );
});
