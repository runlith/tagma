import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { blockQuerySchema } from '../contract/wire/query.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const created = { by: 'created', order: 'asc' } as const;

const lens = (demo: EffectDemo) => {
  const { graph, projectId, root } = demo;
  const query = (input: Parameters<EffectDemo['graph']['selection']['query']>[1]) => graph.selection.query(projectId, input);
  const make = (tag: string, title: string, extra: { edges?: readonly { kind: string; to: number }[]; parentId?: number } = {}) =>
    Effect.map(graph.blocks.create({ projectId, tags: [tag], title, parentId: root, ...extra }), (row) => row.id);
  const idsOf = (page: { readonly items: readonly { readonly name: string }[] }) =>
    Effect.forEach(page.items, (row) => graph.blockNames.idOfName(row.name));
  const found = (input: Parameters<EffectDemo['graph']['selection']['query']>[1]) => Effect.flatMap(query(input), idsOf);
  return { ...demo, query, make, found, idsOf };
};

const withLens = <A, E, R>(body: (given: ReturnType<typeof lens>) => Effect.Effect<A, E, R>) => withDemo((demo) => body(lens(demo)));

layer(demoGraphLayer(), { excludeTestServices: true })('selection queries', (it) => {
  it.effect('a list field is an OR and two fields are an AND', () =>
    withLens(({ graph, make, found }) =>
      Effect.gen(function* () {
        const work = yield* make('task', 'alpha');
        const decision = yield* make('spec', 'beta');
        yield* make('idea', 'gamma');
        expect(yield* found({ tags: ['task', 'spec'], sort: created })).toEqual([work, decision]);
        yield* graph.tasks.claim({ id: work });
        expect(yield* found({ tags: ['task', 'spec'], fields: { status: ['open'] }, sort: created })).toEqual([decision]);
      }),
    ),
  );

  it.effect('list rows keep typed list fields, including singleton, empty, and order', () =>
    withLens(({ graph, projectId, make, nameOf, query, root }) =>
      Effect.gen(function* () {
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#meeting',
          body: 'A meeting record.',
          parentId: root,
          fields: { id: 'meeting', fields: { attendees: { type: 'ref', many: true } } },
        });
        const firstName = yield* nameOf(yield* make('task', 'first attendee'));
        const secondName = yield* nameOf(yield* make('task', 'second attendee'));
        yield* graph.blocks.create({
          projectId,
          tags: ['meeting'],
          title: 'singleton',
          parentId: root,
          fields: { attendees: [firstName] },
        });
        yield* graph.blocks.create({ projectId, tags: ['meeting'], title: 'empty', parentId: root, fields: { attendees: [] } });
        yield* graph.blocks.create({
          projectId,
          tags: ['meeting'],
          title: 'ordered',
          parentId: root,
          fields: { attendees: [secondName, firstName] },
        });
        const expected = [[firstName], [], [secondName, firstName]];
        expect((yield* query({ tags: ['meeting'], sort: created })).items.map((row) => row.fields.attendees)).toEqual(expected);
        const tree = yield* graph.selection.tree(projectId);
        expect(tree.filter((row) => row.tags.includes('meeting')).map((row) => row.fields.attendees)).toEqual(expected);
      }),
    ),
  );

  it.effect('resting work requires an explicit historical selection', () =>
    withLens(({ graph, make, found }) =>
      Effect.gen(function* () {
        const open = yield* make('task', 'open');
        const done = yield* make('task', 'done');
        yield* graph.tasks.claim({ id: done });
        yield* graph.tasks.finish({ id: done });
        const replacement = yield* make('task', 'replacement');
        yield* graph.standing.supersede({ oldId: done, withId: replacement });
        expect(yield* found({ tags: ['task'], sort: created })).toEqual([open, replacement]);
        expect(yield* found({ tags: ['task'], fields: { status: ['done'] }, sort: created })).toEqual([done]);
        expect(yield* found({ tags: ['task'], superseded: true, sort: created })).toEqual([done]);
        expect(yield* found({ tags: ['task'], includeResting: true, sort: created })).toEqual([open, done, replacement]);
      }),
    ),
  );

  it.effect('a replaced block is history whatever its status says', () =>
    withLens(({ graph, make, table, found }) =>
      Effect.gen(function* () {
        const standing = yield* make('spec', 'stands');
        const retired = yield* make('spec', 'replaced');
        const heir = yield* make('spec', 'successor');
        yield* graph.standing.supersede({ oldId: retired, withId: heir });
        const claim = yield* make('idea', 'retired truth');
        const newer = yield* make('idea', 'current truth');
        yield* graph.standing.supersede({ oldId: claim, withId: newer });
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(retired))).toBe('open');
        expect(yield* found({ tags: ['spec'], sort: created })).toEqual([standing, heir]);
        expect(yield* found({ tags: ['spec'], fields: { status: ['open'] }, sort: created })).toEqual([standing, heir]);
        expect(yield* found({ tags: ['idea'], sort: created })).toEqual([newer]);
        expect(yield* found({ tags: ['spec', 'idea'], superseded: true, sort: created })).toEqual([retired, claim]);
        expect(yield* found({ tags: ['spec', 'idea'], includeResting: true, sort: created })).toEqual([
          standing,
          retired,
          heir,
          claim,
          newer,
        ]);
      }),
    ),
  );

  it.effect('answered and superseded reflections require an explicit true fact', () =>
    withLens(({ graph, projectId, make, found, root }) =>
      Effect.gen(function* () {
        const facts = { command: 'tagma query', expected: 'standing rows', actual: 'history' };
        const reflect = (title: string) =>
          Effect.map(graph.blocks.create({ projectId, tags: ['reflection'], title, parentId: root, fields: facts }), (row) => row.id);
        const standing = yield* reflect('standing');
        const answered = yield* reflect('answered');
        const answer = yield* make('task', 'answer');
        yield* graph.tasks.finish({ id: answer });
        yield* graph.reflection.answer({ id: answered, byId: answer });
        const retired = yield* reflect('retired');
        const keeper = yield* reflect('keeper');
        yield* graph.standing.supersede({ oldId: retired, withId: keeper });
        expect(yield* found({ tags: ['reflection'], sort: created })).toEqual([standing, keeper]);
        expect(yield* found({ tags: ['reflection'], answered: true, sort: created })).toEqual([answered]);
        expect(yield* found({ tags: ['reflection'], superseded: true, sort: created })).toEqual([retired]);
        expect(yield* found({ tags: ['reflection'], includeResting: true, sort: created })).toEqual([standing, answered, retired, keeper]);
      }),
    ),
  );

  it.effect('anchorPaths take any source inside the named place and nobody else', () =>
    withLens(({ graph, make, found, demoRoot }) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await mkdir(join(demoRoot, 'apps', 'tagma'), { recursive: true });
          await writeFile(join(demoRoot, 'apps', 'tagma', 'Graph.ts'), 'export const query = 1;\n');
        });
        const symbol = yield* make('idea', 'symbol');
        yield* graph.sources.attach({ blockId: symbol, kind: 'symbol', ref: 'apps/tagma/Graph.ts', symbol: 'query' });
        const area = yield* make('zone', 'zone');
        yield* graph.sources.attach({ blockId: area, kind: 'dir', ref: 'apps/tagma' });
        const neighbour = yield* make('idea', 'neighbour');
        yield* graph.sources.attach({ blockId: neighbour, kind: 'file', ref: 'apps/tagmatic/other.ts' });
        yield* make('idea', 'unanchored');
        expect(yield* found({ anchorPaths: ['./apps/tagma'], sort: created })).toEqual([symbol, area]);
      }),
    ),
  );

  it.effect('withoutAnchorPaths keeps the blocks no source of which lies inside the place', () =>
    withLens(({ graph, make, found }) =>
      Effect.gen(function* () {
        const shared = yield* make('idea', 'shared');
        yield* graph.sources.attach({ blockId: shared, kind: 'file', ref: 'apps/one/a.ts' });
        yield* graph.sources.attach({ blockId: shared, kind: 'file', ref: 'apps/two/a.ts' });
        const own = yield* make('idea', 'own');
        yield* graph.sources.attach({ blockId: own, kind: 'file', ref: 'apps/one/b.ts' });
        const unanchored = yield* make('idea', 'unanchored');
        expect(yield* found({ anchorPaths: ['apps/one'], withoutAnchorPaths: ['apps/two'], sort: created })).toEqual([own]);
        const alone = yield* found({ withoutAnchorPaths: ['apps/two'], sort: created });
        expect(alone).toContain(own);
        expect(alone).toContain(unanchored);
        expect(alone).not.toContain(shared);
      }),
    ),
  );

  it.effect('a status filter beside tags that report no work is refused, not silently empty', () =>
    withLens(({ graph, projectId, make, found, refusal, root }) =>
      Effect.gen(function* () {
        const saved = (yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'a slice',
          parentId: root,
          fields: { query: { tags: ['task'], sort: created } },
        })).id;
        const work = yield* make('task', 'alpha');
        const refused = yield* refusal(
          graph.selection.query(projectId, { tags: ['view', 'zone'], fields: { status: ['open', 'done'] }, sort: created }),
        );
        expect(refused.code).toBe('query-shape');
        expect(refused.reason).toContain('#view, #zone');
        expect(refused.unblock.join(' ')).toContain('drop "status"');
        expect(yield* found({ tags: ['view'], sort: created })).toEqual([saved]);
        expect(yield* found({ tags: ['view', 'task'], fields: { status: ['open'] }, sort: created })).toEqual([work]);
        expect(yield* found({ fields: { status: ['open'] }, sort: created })).toContain(work);
      }),
    ),
  );

  it.effect('a path that leaves the project root is refused, not silently empty', () =>
    withLens(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const refused = yield* refusal(graph.selection.query(projectId, { anchorPaths: ['../elsewhere'], sort: created }));
        expect(refused.code).toBe('source-outside');
      }),
    ),
  );

  it.effect('an edge filter reads one direction and one hop, and accepts a project-declared edge name', () =>
    withLens(({ graph, projectId, make, nameOf, found, root }) =>
      Effect.gen(function* () {
        const decision = yield* make('spec', 'spec');
        const work = yield* make('task', 'work', { edges: [{ kind: 'implements', to: decision }] });
        const other = yield* make('task', 'other');
        const toDecision = yield* found({ edge: { kind: 'implements', to: yield* nameOf(decision) }, sort: created });
        expect(toDecision).toEqual([work]);
        expect(toDecision).not.toContain(other);
        expect(yield* found({ edge: { kind: 'implements', from: yield* nameOf(work) }, sort: created })).toEqual([decision]);
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#meeting',
          body: 'A meeting record.',
          parentId: root,
          fields: { id: 'meeting', edges: ['reviews'] },
        });
        const first = yield* graph.blocks.create({ projectId, tags: ['task', 'meeting'], title: 'first', parentId: root });
        const second = yield* graph.blocks.create({ projectId, tags: ['meeting'], title: 'second', parentId: root });
        yield* graph.edges.link({ fromId: first.id, kind: 'reviews', toId: second.id });
        expect(yield* found({ edge: { kind: 'reviews', to: yield* nameOf(second.id) }, sort: created })).toEqual([first.id]);
      }),
    ),
  );

  it.effect('a transitive edge walks the whole chain in both directions, and a cycle terminates', () =>
    withLens(({ graph, make, nameOf, found }) =>
      Effect.gen(function* () {
        const origin = yield* make('idea', 'origin');
        const middle = yield* make('task', 'middle', { edges: [{ kind: 'discovered-from', to: origin }] });
        const leaf = yield* make('task', 'leaf', { edges: [{ kind: 'discovered-from', to: middle }] });
        const stranger = yield* make('task', 'stranger');
        const originName = yield* nameOf(origin);
        expect(yield* found({ edge: { kind: 'discovered-from', to: originName }, sort: created })).toEqual([middle]);
        const chain = yield* found({ edge: { kind: 'discovered-from', to: originName, transitive: true }, sort: created });
        expect(chain).toEqual([middle, leaf]);
        expect(chain).not.toContain(stranger);
        expect(chain).not.toContain(origin);
        expect(yield* found({ edge: { kind: 'discovered-from', from: yield* nameOf(leaf), transitive: true }, sort: created })).toEqual([
          origin,
          middle,
        ]);
        const a = yield* make('task', 'a');
        const b = yield* make('task', 'b');
        yield* graph.edges.link({ fromId: a, kind: 'relates', toId: b });
        yield* graph.edges.link({ fromId: b, kind: 'relates', toId: a });
        expect(yield* found({ edge: { kind: 'relates', from: yield* nameOf(a), transitive: true }, sort: created })).toEqual([a, b]);
      }),
    ),
  );

  it.effect('ended orders by the entry that ended a block, and one that never ended comes last', () =>
    withLens(({ graph, make, found }) =>
      Effect.gen(function* () {
        const first = yield* make('task', 'first');
        const second = yield* make('task', 'second');
        const unended = yield* make('task', 'unended');
        yield* graph.tasks.claim({ id: second });
        yield* graph.tasks.finish({ id: second });
        yield* Effect.sleep('2 millis');
        yield* graph.tasks.close({ id: first });
        expect(yield* found({ tags: ['task'], includeResting: true, sort: { by: 'ended', order: 'desc' } })).toEqual([
          first,
          second,
          unended,
        ]);
        expect(yield* found({ tags: ['task'], includeResting: true, sort: { by: 'ended', order: 'asc' } })).toEqual([
          second,
          first,
          unended,
        ]);
      }),
    ),
  );

  it.effect('every order ends with id in the same direction, and limit is the window while total is what matched', () =>
    withLens(({ query, make, found, idsOf }) =>
      Effect.gen(function* () {
        const written = [yield* make('task', 'a'), yield* make('task', 'b'), yield* make('task', 'c')];
        expect(yield* found({ tags: ['task'], sort: created })).toEqual(written);
        expect(yield* found({ tags: ['task'], sort: { by: 'created', order: 'desc' } })).toEqual([...written].reverse());
        const page = yield* query({ tags: ['task'], sort: created, limit: 2 });
        expect(yield* idsOf(page)).toEqual(written.slice(0, 2));
        expect(page.total).toBe(3);
      }),
    ),
  );

  it.effect('a scope takes the subtree with its root, and a trashed scope answers nothing', () =>
    withLens(({ graph, make, nameOf, found, query }) =>
      Effect.gen(function* () {
        const area = yield* make('zone', 'zone');
        const inside = yield* make('task', 'inside', { parentId: area });
        yield* make('task', 'outside');
        const scope = [yield* nameOf(area)];
        expect(yield* found({ scope, sort: created })).toEqual([area, inside]);
        yield* graph.trash.delete({ id: area });
        const gone = yield* query({ scope, sort: created });
        expect(gone.items).toHaveLength(0);
        expect(gone.total).toBe(0);
      }),
    ),
  );
});

test('the query contract refuses an empty list and an edge pointing both ways', () => {
  const sort = { by: 'updated', order: 'desc' } as const;
  const accepts = (input: unknown) => Schema.decodeUnknownResult(blockQuerySchema)(input)._tag === 'Success';
  expect(accepts({ tags: [], sort })).toBe(false);
  expect(accepts({ tags: ['task'], sort })).toBe(true);
  expect(accepts({ edge: { kind: 'waits-on', to: 'aaaaaaaa', from: 'bbbbbbbb' }, sort })).toBe(false);
  expect(accepts({ edge: { kind: 'waits-on', to: 'aaaaaaaa' }, sort })).toBe(true);
});
