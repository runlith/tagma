import { Effect, Schema } from 'effect';
import { withGraphCall } from '../../invocation/testing/call.js';
import { BLOCK_READ_PAIRS } from '../operations/blocks.js';
import { READ_OPERATIONS } from '../contract/wire/operations/reads.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const sort = { by: 'created', order: 'asc' } as const;

const subtype = ({ graph, projectId }: EffectDemo) =>
  graph.blocks.create({
    projectId,
    tags: ['tag'],
    title: 'A specialized task',
    fields: { id: 'chore', extends: 'task', identity: { name: 'special' } },
  });

layer(demoGraphLayer({ projects: ['other'] }), { excludeTestServices: true })('selectors', (it) => {
  it.effect('a saved exact view keeps its set while descendants and contract support include a subtype', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, nameOf, refusal, table } = demo;
        const root = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Scope' });
        const scope = [yield* nameOf(root.id)];
        const base = yield* graph.blocks.create({ projectId, parentId: root.id, tags: ['task'], title: 'Base work' });
        const view = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'Exact work',
          fields: { query: { tags: ['task'], scope, sort } },
        });
        const namesOfView = (id: number) => Effect.map(graph.reading.show(id, 0), (page) => page.results?.items.map((row) => row.name));
        const baseName = yield* nameOf(base.id);
        expect(yield* namesOfView(view.id)).toEqual([baseName]);
        yield* subtype(demo);
        const child = yield* graph.blocks.create({ projectId, parentId: root.id, tags: ['chore'], title: 'Specialized work' });
        const childName = yield* nameOf(child.id);
        expect(yield* namesOfView(view.id)).toEqual([baseName]);
        for (const [selector, expected] of [
          [{ kind: 'exact', types: ['task'] }, [baseName]],
          [{ kind: 'descendants', types: ['task'] }, [baseName, childName]],
          [{ kind: 'descendants', types: ['chore', 'task'] }, [baseName, childName]],
          [{ kind: 'supports', contract: 'core/lifecycle' }, [baseName, childName]],
        ] as const) {
          const page = yield* graph.selection.query(projectId, { selector, scope, sort });
          expect(page.items.map((row) => row.name)).toEqual([...expected]);
          expect(page.total).toBe(expected.length);
        }
        const tags = yield* table();
        expect(tags.supports({ tags: ['chore'] }, 'core/lifecycle')).toBe(true);
        expect(tags.typesSupporting('core/lifecycle')).toContain('chore');
        const special = yield* refusal(graph.selection.query(projectId, { selector: { kind: 'exact', types: ['special'] }, scope, sort }));
        expect(special.code).toBe('query-shape');
        const inherited = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'Inherited work',
          fields: { query: { selector: { kind: 'descendants', types: ['task', 'special'] }, scope, sort } },
        });
        expect((yield* graph.blocks.blockById(inherited.id)).fields.query).toEqual({
          selector: { kind: 'descendants', types: [tags.identities.typeOf('task')!.id, tags.identities.typeOf('chore')!.id] },
          scope,
          sort,
        });
        expect(yield* namesOfView(inherited.id)).toEqual([baseName, childName]);
      }),
    ),
  );

  it.effect('an existing open-child gate blocks only exact children after a subtype is declared', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, refusal, table } = demo;
        const parent = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Parent' });
        const exact = yield* graph.blocks.create({ projectId, parentId: parent.id, tags: ['task'], title: 'Exact child' });
        expect((yield* refusal(graph.tasks.close({ id: parent.id }))).code).toBe('open-children');
        yield* subtype(demo);
        const child = yield* graph.blocks.create({ projectId, parentId: parent.id, tags: ['chore'], title: 'Subtype child' });
        expect((yield* refusal(graph.tasks.close({ id: parent.id }))).code).toBe('open-children');
        yield* graph.tasks.close({ id: exact.id });
        yield* graph.tasks.close({ id: parent.id });
        const tags = yield* table();
        expect(tags.statusOf(yield* graph.blocks.blockById(parent.id))).toBe('closed');
        expect(tags.statusOf(yield* graph.blocks.blockById(child.id))).toBe('open');
      }),
    ),
  );

  it.effect('cross-project selectors resolve each identity in its own vocabulary and reject references unknown everywhere', () =>
    withDemo(({ graph, projectId, project, nameOf, refusal, table }) =>
      Effect.gen(function* () {
        const other = project('other').id;
        for (const [owner, id] of [
          [projectId, 'record'],
          [other, 'record'],
          [other, 'memo'],
        ] as const) {
          yield* graph.blocks.create({ projectId: owner, tags: ['tag'], title: id, fields: { id } });
        }
        const first = yield* graph.blocks.create({ projectId, tags: ['record'], title: 'crossselector first' });
        yield* graph.blocks.create({ projectId: other, tags: ['record'], title: 'crossselector unrelated' });
        const second = yield* graph.blocks.create({ projectId: other, tags: ['memo'], title: 'crossselector second' });
        const own = (yield* table(projectId)).identities.typeOf('record')!.id;
        const foreign = (yield* table(other)).identities.typeOf('memo')!.id;
        const selector = { kind: 'exact' as const, types: [own, foreign] };
        expect((yield* graph.selection.rows({ selector, sort })).map((row) => row.id)).toEqual([first.id, second.id]);
        const search = yield* graph.ranking.search({ query: 'crossselector', selector });
        expect(new Set(search.items.map((row) => row.name))).toEqual(new Set([yield* nameOf(first.id), yield* nameOf(second.id)]));
        expect(yield* graph.selection.rows({ tags: ['record', 'memo'], sort })).toHaveLength(3);
        const absent = { kind: 'exact', types: [own, 'local:absent'] } as const;
        expect((yield* refusal(graph.selection.rows({ selector: absent, sort }))).code).toBe('query-shape');
        expect((yield* refusal(graph.ranking.search({ query: 'crossselector', selector: absent }))).code).toBe('query-shape');
      }),
    ),
  );

  it.effect('query and search continuations retain the selected type identities after an alias rename', () =>
    withDemo(({ graph, projectId, nameOf, table }) =>
      Effect.gen(function* () {
        const declared = yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: 'Record',
          fields: { id: 'record', identity: { name: 'entry' } },
        });
        const first = yield* graph.blocks.create({ projectId, tags: ['entry'], title: 'selector record first' });
        yield* graph.blocks.create({ projectId, tags: ['tag'], title: 'Detailed record', fields: { id: 'detail', extends: 'entry' } });
        const second = yield* graph.blocks.create({ projectId, tags: ['detail'], title: 'selector record second' });
        const selector = { kind: 'descendants', types: ['entry'] };
        const caller = { actor: { kind: 'operator' as const }, files: null };
        const call = Effect.gen(function* () {
          return {
            project: { id: projectId, name: 'demo' },
            vocabulary: yield* table().pipe(Effect.orDie),
            lens: { scope: undefined, names: 'law-and-reflections' as const },
            deliveredTags: new Set<string>(),
          };
        });
        const query = Effect.fnUntraced(function* (input: unknown) {
          const decoded = yield* Schema.decodeUnknownEffect(READ_OPERATIONS.query_blocks.input)(input);
          const prepared = yield* BLOCK_READ_PAIRS.query_blocks.body.prepare!(decoded, caller).pipe(withGraphCall(call));
          return yield* BLOCK_READ_PAIRS.query_blocks.body.execute(decoded, prepared, caller).pipe(withGraphCall(call));
        });
        const search = Effect.fnUntraced(function* (input: unknown) {
          const decoded = yield* Schema.decodeUnknownEffect(READ_OPERATIONS.search_blocks.input)(input);
          const prepared = yield* BLOCK_READ_PAIRS.search_blocks.body.prepare!(decoded, caller).pipe(withGraphCall(call));
          return yield* BLOCK_READ_PAIRS.search_blocks.body.execute(decoded, prepared, caller).pipe(withGraphCall(call));
        });
        const queried = yield* query({ selector, sort, limit: 1 });
        expect(queried).toMatchObject({ total: 2, blocks: [{ name: yield* nameOf(first.id) }] });
        const searched = yield* search({ query: 'selector record', selector, limit: 1 });
        expect(searched.total).toBe(2);
        yield* graph.blocks.update({ id: declared.id, fields: { identity: { name: 'renamed' } } });
        const next = yield* query({ cursor: queried.next });
        expect(next).toMatchObject({ total: 2, next: null, blocks: [{ name: yield* nameOf(second.id) }] });
        const rest = yield* search({ cursor: searched.next });
        expect(rest).toMatchObject({ total: 2, next: null });
        expect(new Set([...searched.blocks, ...rest.blocks].map((row) => row.name))).toEqual(
          new Set([yield* nameOf(first.id), yield* nameOf(second.id)]),
        );
        expect(yield* query({ selector: { kind: 'exact', types: ['renamed'] }, sort })).toMatchObject({
          total: 1,
          blocks: [{ name: yield* nameOf(first.id) }],
        });
      }),
    ),
  );

  it.effect('unknown references refuse, while a registered contract with no matching nodes answers zero', () =>
    withDemo(({ graph, projectId, nameOf, refusal }) =>
      Effect.gen(function* () {
        for (const selector of [
          { kind: 'exact', types: ['local:missing'] },
          { kind: 'supports', contract: 'core/missing' },
        ] as const) {
          expect((yield* refusal(graph.selection.query(projectId, { selector, sort }))).code).toBe('query-shape');
        }
        expect((yield* refusal(graph.selection.query(projectId, { tags: ['missing'], sort }))).code).toBe('query-shape');
        const root = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Empty scope' });
        const page = yield* graph.selection.query(projectId, {
          selector: { kind: 'supports', contract: 'core/lifecycle' },
          scope: [yield* nameOf(root.id)],
          sort,
        });
        expect(page).toMatchObject({ items: [], total: 0 });
      }),
    ),
  );
});
