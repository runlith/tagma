import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const lens = ({ graph, projectId }: EffectDemo) => {
  const make = (tag: 'spec' | 'task' | 'idea', title: string, parentId?: number) =>
    Effect.map(graph.blocks.create({ projectId, tags: [tag], title, parentId }), (row) => row.id);
  const replaced = Effect.fnUntraced(function* (tag: 'spec' | 'task') {
    const old = yield* make(tag, 'replaced');
    const heir = yield* make(tag, 'successor');
    yield* graph.standing.supersede({ oldId: old, withId: heir });
    return { old, heir };
  });
  return { make, replaced };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer(), { excludeTestServices: true })('a replaced block is out of the work', (it) => {
  it.effect('a retired task cannot be claimed, finished, closed or released, and the refusal names its successor', () =>
    withLens(({ graph, replaced, nameOf, refusal, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const { old, heir } = yield* replaced('task');
        const claim = yield* refusal(graph.tasks.claim({ id: old }));
        expect(claim.code).toBe('superseded');
        expect(claim.reason).toContain(yield* nameOf(heir));
        expect(tags.statusOf(yield* graph.blocks.blockById(old))).toBe('open');
        expect((yield* refusal(graph.tasks.finish({ id: old }))).code).toBe('superseded');
        expect((yield* refusal(graph.tasks.close({ id: old }))).code).toBe('superseded');
        expect((yield* refusal(graph.tasks.release({ id: old }))).code).toBe('not-held');
        expect(tags.holderOf(yield* graph.blocks.blockById(old))).toBeNull();
      }),
    ),
  );

  it.effect('a retired spec takes no new implementer, but an implements edge written before the replacement stays', () =>
    withLens(({ graph, make, replaced, refusal }) =>
      Effect.gen(function* () {
        const { old } = yield* replaced('spec');
        const task = yield* make('task', 'work');
        expect((yield* refusal(graph.edges.link({ fromId: task, kind: 'implements', toId: old }))).code).toBe('superseded');
        const spec = yield* make('spec', 'spec');
        const earlier = yield* make('task', 'earlier work');
        yield* graph.edges.link({ fromId: earlier, kind: 'implements', toId: spec });
        yield* graph.standing.supersede({ oldId: spec, withId: yield* make('spec', 'successor') });
        expect((yield* graph.reading.show(earlier, 0)).edgesOut.some((e) => e.kind === 'implements' && e.toId === spec)).toBe(true);
      }),
    ),
  );

  it.effect('a retired body is not rewritten, but the block still moves', () =>
    withLens(({ graph, make, replaced, refusal }) =>
      Effect.gen(function* () {
        const { old } = yield* replaced('spec');
        expect((yield* refusal(graph.blocks.update({ id: old, body: 'rewritten' }))).code).toBe('superseded');
        expect((yield* refusal(graph.blocks.update({ id: old, title: 'renamed' }))).code).toBe('superseded');
        expect((yield* refusal(graph.blocks.edit({ id: old, old: 'replaced', new: 'x' }))).code).toBe('anchor-not-found');
        const home = yield* make('spec', 'home');
        expect((yield* graph.blocks.update({ id: old, parentId: home })).parentId).toBe(home);
      }),
    ),
  );

  it.effect('a task in work leaves work with its replacement: its hold ends in the same act', () =>
    withLens(({ graph, make, as, table }) =>
      Effect.gen(function* () {
        const held = yield* make('task', 'held');
        const heir = yield* make('task', 'successor');
        yield* as('holder', graph.tasks.claim({ id: held }));
        expect((yield* graph.standing.supersede({ oldId: held, withId: heir })).superseded).toBe(true);
        const tags = yield* table();
        const retired = yield* graph.blocks.rawBlockById(held);
        expect(tags.statusOf(retired)).toBe('open');
        expect(tags.holderOf(retired)).toBeNull();
      }),
    ),
  );

  it.effect('a retired parent hides itself, never the standing blocks under it', () =>
    withLens(({ graph, make }) =>
      Effect.gen(function* () {
        const area = yield* make('spec', 'area');
        const retired = yield* make('spec', 'replaced', area);
        const kept = yield* make('idea', 'still true', retired);
        const heir = yield* make('spec', 'successor', area);
        yield* graph.standing.supersede({ oldId: retired, withId: heir });
        const shown = (yield* graph.reading.show(area, 3)).children.map((child) => child.title);
        expect(shown).not.toContain('replaced');
        expect(shown).toContain('still true');
        expect(shown).toContain('successor');
        expect((yield* graph.blocks.blockById(kept)).parentId).toBe(retired);
        expect((yield* graph.reading.show(area, 3, true)).children.map((child) => child.title)).toContain('replaced');
        const zone = yield* graph.reading.zone(area);
        expect(zone.page).not.toContain('replaced');
        expect(zone.page).toContain('still true');
        expect(zone.total).toBe(3);
      }),
    ),
  );
});
