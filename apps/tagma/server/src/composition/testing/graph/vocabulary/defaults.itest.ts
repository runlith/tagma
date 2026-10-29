import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type EffectDemo, demoGraphLayer, withDemo } from '../../graphFixture.js';
import { fileReflection, filedReflections } from '../../../../reflections/filing.js';
import { localTypeId, shippedTypeId, CORE_LIBRARY } from '../../../../graph/contract/wire/tags/identity.js';
import { REFLECTION } from '../../../../graph/contract/wire/tags/reflection.js';
import { SELECTION } from '../../../../graph/contract/wire/tags/selection.js';
import type { CreationDefault } from '../../../../graph/contract/wire/tags/profile.js';
import { batchDocument } from '../../../../graph/contract/wire/batch.js';

const profile = Effect.fn('defaultsFixture.profile')(function* (
  demo: EffectDemo,
  projectId: number,
  defaults: readonly CreationDefault[],
  key = 'local-defaults',
) {
  const member = (yield* demo.table(projectId)).identities.typeOf(shippedTypeId(CORE_LIBRARY, 'view'))?.declaration;
  if (member == null) return yield* Effect.die('the fixture has no view declaration');
  const root = yield* demo.graph.blocks.rootBlockOf(projectId);
  return yield* demo.graph.blocks.create({
    projectId,
    parentId: root.id,
    tags: ['catalog'],
    title: 'local creation choices',
    fields: { id: key, tags: [member], profile: { defaults } },
  });
});

const localType = (demo: EffectDemo, projectId: number, key: string, fields: Readonly<Record<string, unknown>>) =>
  demo.graph.blocks.rootBlockOf(projectId).pipe(
    Effect.flatMap((root) =>
      demo.graph.blocks.create({ projectId, parentId: root.id, tags: ['tag'], title: key, fields: { id: key, ...fields } }),
    ),
    Effect.map((row) => localTypeId(row.uuid.replaceAll('-', '').toLowerCase())),
  );

const query = { tags: [shippedTypeId('software-development', 'task')], sort: { by: 'created' as const, order: 'asc' as const } };

layer(demoGraphLayer({ projects: ['elsewhere'] }))('creation defaults', (it) => {
  it.effect('selection defaults, explicit types and batch handles keep their chosen contracts', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const work = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'work selected' });
        const saved = yield* graph.blocks.create({
          projectId,
          parentId: root,
          contract: SELECTION,
          title: 'saved work',
          fields: { query },
        });
        expect((yield* demo.table()).identities.typeOf(saved.tags[0]!)?.id).toBe(shippedTypeId(CORE_LIBRARY, 'view'));
        expect((yield* graph.reading.show(saved.id, 0)).results?.items.map((row) => row.name)).toEqual([yield* demo.nameOf(work.id)]);
        expect((yield* graph.blocks.create({ projectId, parentId: root, title: 'a note' })).tags).toEqual([]);
        const id = yield* localType(demo, projectId, 'board', { extends: shippedTypeId(CORE_LIBRARY, 'view') });
        yield* profile(demo, projectId, [{ contract: SELECTION, type: id, override: true }]);
        const board = yield* graph.blocks.create({
          projectId,
          parentId: root,
          contract: SELECTION,
          title: 'local board',
          fields: { query },
        });
        expect(board.tags).toEqual(['board']);
        const explicit = yield* graph.blocks.create({
          projectId,
          parentId: root,
          contract: SELECTION,
          tags: [shippedTypeId(CORE_LIBRARY, 'view')],
          title: 'explicit view',
          fields: { query },
        });
        expect(explicit.tags).toEqual(['view']);
        const batch = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'work', parentId: yield* demo.nameOf(root), tags: ['task'], title: 'scoped work' },
            {
              op: 'create',
              $id: 'selection',
              parentId: yield* demo.nameOf(root),
              contract: SELECTION,
              title: 'saved scope',
              fields: { query: { ...query, scope: ['$work'] } },
            },
          ]),
          projectId,
        );
        const selection = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(batch.ids.selection!));
        expect(selection.fields.query).toEqual({ ...query, scope: [batch.ids.work] });
        expect((yield* graph.reading.show(selection.id, 0)).results?.items.map((row) => row.name)).toEqual([batch.ids.work!]);
      }),
    ),
  );

  it.effect('unknown, incompatible and competing defaults refuse before creating a carrier', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const configured = yield* profile(demo, projectId, [
          { contract: SELECTION, type: shippedTypeId('unknown', 'missing'), override: true },
        ]);
        const carrier = { projectId, parentId: root, title: 'refused carrier' };
        const create = () => graph.blocks.create({ ...carrier, contract: SELECTION, fields: { query } });
        expect((yield* demo.refusal(create())).code).toBe('creation-default-invalid');
        yield* graph.blocks.update({
          id: configured.id,
          fields: { profile: { defaults: [{ contract: SELECTION, type: shippedTypeId('software-development', 'task'), override: true }] } },
        });
        expect((yield* demo.refusal(create())).code).toBe('creation-default-invalid');
        const choices = [{ contract: SELECTION, type: shippedTypeId(CORE_LIBRARY, 'view'), override: true as const }];
        yield* graph.blocks.update({ id: configured.id, fields: { profile: { defaults: choices } } });
        yield* profile(demo, projectId, choices, 'other-defaults');
        expect((yield* demo.refusal(create())).code).toBe('creation-default-ambiguous');
        expect((yield* demo.refusal(graph.blocks.create({ ...carrier, contract: 'core/unknown' }))).code).toBe('creation-default-missing');
        expect((yield* demo.refusal(graph.blocks.create({ ...carrier, contract: SELECTION, tags: ['task'] }))).code).toBe(
          'creation-contract',
        );
        const current = yield* graph.selection.query(projectId, { sort: query.sort });
        expect(current.items.filter((row) => row.title === carrier.title)).toEqual([]);
      }),
    ),
  );

  it.effect('reflection filing uses the destination profile and mapped slots, and sightings remain one keeper', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { projectId } = demo;
        const origin = demo.project('elsewhere');
        const destination = yield* localType(demo, projectId, 'friction', {
          fields: {
            invoked: { type: 'schema', name: 'line' },
            wanted: { type: 'schema', name: 'line' },
            seen: { type: 'schema', name: 'line' },
          },
          gates: ['invoked', 'wanted', 'seen'].map((field) => ({ gate: 'required', field })),
          contracts: {
            'core/observation': { slots: {}, words: {} },
            [REFLECTION]: { slots: { command: 'invoked', expected: 'wanted', actual: 'seen' }, words: {} },
          },
        });
        yield* profile(demo, projectId, [{ contract: REFLECTION, type: destination, override: true }]);
        yield* profile(demo, origin.id, [{ contract: REFLECTION, type: shippedTypeId('wrong', 'type'), override: true }]);
        const filing = {
          title: 'instrument friction',
          command: 'an act',
          expected: 'the result',
          actual: 'a refusal',
          project: 'elsewhere',
          cwd: origin.root,
        };
        const first = yield* fileReflection(filing);
        expect(first.entry.projectId).toBe(projectId);
        expect(first.written.tags).toEqual(['friction']);
        expect(first.written.fields).toMatchObject({ invoked: filing.command, wanted: filing.expected, seen: filing.actual });
        const second = yield* fileReflection({ ...filing, ontoId: first.entry.id });
        expect(second.written.parentId).toBe(first.entry.id);
        expect((yield* filedReflections(undefined, 100)).rows.map((row) => ({ id: row.id, sightings: row.sightings }))).toEqual([
          { id: first.entry.id, sightings: 2 },
        ]);
      }),
    ),
  );
});
