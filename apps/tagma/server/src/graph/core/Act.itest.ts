import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { ref, searchIndex } from '../store/tables.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

type Extra = { edges?: readonly { kind: string; to: number }[]; parentId?: number };

const lens = ({ graph, projectId, root }: EffectDemo) => {
  const make = (tag: string, title: string, extra: Extra = {}) =>
    Effect.map(graph.blocks.create({ projectId, tags: [tag], title, parentId: root, ...extra }), (row) => row.id);
  const refsIn = (id: number) => Effect.map(graph.reading.show(id, 0), (page) => page.refsInDetails.map((ref) => ref.name));
  return { make, refsIn };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer(), { excludeTestServices: true })('body reference index', (it) => {
  it.effect('body writes, trash and projection completion maintain references and search', () =>
    withLens(({ graph, projectId, make, nameOf, refsIn }) =>
      Effect.gen(function* () {
        const target = yield* make('spec', 'target');
        const source = yield* make('task', 'mentions');
        const [targetName, sourceName] = [yield* nameOf(target), yield* nameOf(source)];
        yield* graph.blocks.update({ id: source, body: `см. [[${targetName}]]` });
        expect((yield* graph.reading.show(source, 0)).refsOutDetails.map((ref) => ref.name)).toEqual([targetName]);
        expect(yield* refsIn(target)).toEqual([sourceName]);
        yield* graph.blocks.update({ id: source, body: 'ссылок больше нет' });
        expect((yield* graph.reading.show(source, 0)).refsOutDetails).toEqual([]);
        expect(yield* refsIn(target)).toEqual([]);
        yield* graph.blocks.update({ id: source, body: `[[${targetName}]]` });
        yield* graph.trash.delete({ id: source });
        expect(yield* refsIn(target)).toEqual([]);
        yield* graph.trash.restore({ id: source });
        expect(yield* refsIn(target)).toEqual([sourceName]);
        yield* graph.graphStore.db.delete(ref);
        yield* graph.graphStore.db.delete(searchIndex).where(eq(searchIndex.blockId, source));
        expect(yield* refsIn(target)).toEqual([]);
        yield* graph.blockProjection.completeDerived();
        expect(yield* refsIn(target)).toEqual([sourceName]);
        const found = yield* nameOf(yield* make('spec', 'Черногория trips'));
        yield* graph.graphStore.db.delete(searchIndex);
        yield* graph.blockProjection.completeDerived('types');
        const hits = yield* graph.ranking.search({ query: 'Черногорию trip', projectId });
        expect(hits.items.map((hit) => hit.name)).toEqual([found]);
      }),
    ),
  );

  it.effect('what finished work points here is folded apart, and includeResting names it with the rest', () =>
    withLens(({ graph, make, nameOf }) =>
      Effect.gen(function* () {
        const target = yield* make('spec', 'the module');
        const targetName = yield* nameOf(target);
        const standing = yield* make('task', 'still going', { edges: [{ kind: 'discovered-from', to: target }] });
        const finished = yield* make('task', 'built it', { edges: [{ kind: 'discovered-from', to: target }] });
        for (const id of [standing, finished]) yield* graph.blocks.update({ id, body: `reference zone [[${targetName}]]` });
        yield* graph.tasks.claim({ id: finished });
        yield* graph.tasks.finish({ id: finished });
        const [standingName, finishedName] = [yield* nameOf(standing), yield* nameOf(finished)];
        const page = yield* graph.reading.show(target, 0);
        expect(page.refsInDetails.map((ref) => ref.name)).toEqual([standingName]);
        expect(page.edgesIn.map((edge) => edge.fromUuid?.replaceAll('-', '').endsWith(standingName))).toEqual([true]);
        expect(page.restingIn.refsDetails.map((ref) => ref.name)).toEqual([finishedName]);
        expect(page.restingIn.edges.map((edge) => edge.kind)).toEqual(['discovered-from']);
        const whole = yield* graph.reading.show(target, 0, true);
        expect(whole.refsInDetails.map((ref) => ref.name).sort()).toEqual([standingName, finishedName].sort());
        expect(whole.edgesIn).toHaveLength(2);
        expect(whole.restingIn).toEqual({ edges: [], refsDetails: [] });
      }),
    ),
  );

  it.effect('a write that moves the claim answers with the blocks that point at it', () =>
    withLens(({ graph, projectId, make, nameOf, root }) =>
      Effect.gen(function* () {
        const target = yield* make('spec', 'the dealt recipes');
        const targetName = yield* nameOf(target);
        const pointer = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'reader',
          parentId: root,
          body: `which recipe is not reproducible ([[${targetName}]])`,
        });
        const pointerName = yield* nameOf(pointer.id);
        expect((yield* graph.blocks.update({ id: target, title: 'Something else entirely' })).refsIn).toEqual([pointerName]);
        expect((yield* graph.blocks.update({ id: target, body: 'a different subject' })).refsIn).toEqual([pointerName]);
        expect((yield* graph.blocks.edit({ id: target, old: 'different', new: 'third' })).refsIn).toEqual([pointerName]);
        const elsewhere = yield* make('zone', 'elsewhere');
        expect((yield* graph.blocks.update({ id: target, parentId: elsewhere })).refsIn).toEqual([]);
        expect((yield* graph.blocks.update({ id: pointer.id, title: 'renamed' })).refsIn).toEqual([]);
        yield* graph.trash.delete({ id: pointer.id });
        expect((yield* graph.blocks.update({ id: target, title: 'again' })).refsIn).toEqual([]);
      }),
    ),
  );

  it.effect('titles answer for live blocks only, and a trashed one stops answering', () =>
    withLens(({ graph, projectId, make, nameOf }) =>
      Effect.gen(function* () {
        const alive = yield* make('spec', 'alive');
        const trashed = yield* make('spec', 'trashed');
        const [aliveName, trashedName] = [yield* nameOf(alive), yield* nameOf(trashed)];
        yield* graph.trash.delete({ id: trashed });
        expect(yield* graph.selection.titles([aliveName, trashedName, 'deadbeef'])).toMatchObject([
          { name: aliveName, title: 'alive', projectId },
        ]);
        yield* graph.trash.restore({ id: trashed });
        expect(yield* graph.selection.titles([trashedName])).toMatchObject([{ name: trashedName, title: 'trashed', projectId }]);
      }),
    ),
  );
});
