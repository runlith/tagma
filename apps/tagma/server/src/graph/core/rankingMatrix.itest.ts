import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { pageRows } from '@runlith/paging';
import { batchDocument } from '../contract/wire/batch.js';
import { BLOCKS } from '../contract/wire/operations/shared.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const PAGE = 3;
const WORD = 'obsidian';
const PLANTED = 2;
const created = { by: 'created', order: 'asc' } as const;

const planting = Effect.fnUntraced(function* ({ graph, projectId, root, nameOf }: EffectDemo) {
  const parentId = yield* nameOf(root);
  yield* graph.batch.apply(
    batchDocument([
      ...Array.from({ length: PLANTED }, (_, index) => ({ op: 'create' as const, tags: ['idea'], title: `${WORD} ${index}`, parentId })),
      ...Array.from({ length: PLANTED }, (_, index) => ({
        op: 'create' as const,
        tags: ['idea'],
        title: `${WORD}stone ${index}`,
        parentId,
      })),
      ...Array.from({ length: PLANTED }, (_, index) => ({
        op: 'create' as const,
        tags: ['idea'],
        title: `unrelated ${index}`,
        body: `holds ${WORD} inside`,
        parentId,
      })),
    ]),
    projectId,
  );
});

const lens = ({ graph, projectId, root }: EffectDemo) => {
  const make = (input: { title: string; body?: string; tag?: 'spec' | 'task' | 'zone' | 'idea' | 'explanation'; parentId?: number }) =>
    Effect.map(
      graph.blocks.create({
        projectId,
        tags: [input.tag ?? 'idea'],
        title: input.title,
        body: input.body,
        parentId: input.parentId ?? root,
      }),
      (row) => row.id,
    );
  const found = (input: Parameters<EffectDemo['graph']['ranking']['search']>[0]) =>
    Effect.flatMap(graph.ranking.search(input), (page) => Effect.forEach(page.items, (hit) => graph.blockNames.idOfName(hit.name)));
  const walkSearch = Effect.fnUntraced(function* (query: string, limit: number) {
    const hits: { readonly name: string; readonly title: string }[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = yield* graph.ranking.search({ query, projectId, cursor, limit });
      hits.push(...page.items);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    return hits;
  });
  const walkSelection = Effect.fnUntraced(function* (query: Parameters<EffectDemo['graph']['selection']['queryPage']>[1]) {
    const names: string[] = [];
    const totals = new Set<number>();
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = yield* graph.selection.queryPage(projectId, query, cursor);
      totals.add(page.total);
      names.push(...page.items.map((row) => row.name));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    return { names, totals };
  });
  return { make, found, walkSearch, walkSelection };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer({ prepareEffect: planting }), { excludeTestServices: true })('search ranking matrix', (it) => {
  it.effect('one term: whole title token, then title substring, then body', () =>
    withLens(({ projectId, make, found }) =>
      Effect.gen(function* () {
        const whole = yield* make({ title: 'palladium ledger', body: 'nothing else' });
        const inside = yield* make({ title: 'palladiummaster', body: 'nothing else' });
        const bodyOnly = yield* make({ title: 'quiet notes', body: 'the palladium sits here' });
        expect(yield* found({ query: 'palladium', projectId })).toEqual([whole, inside, bodyOnly]);
      }),
    ),
  );

  it.effect('two terms: a title holding every term, then some, then none', () =>
    withLens(({ projectId, make, found }) =>
      Effect.gen(function* () {
        const both = yield* make({ title: 'meridian quarry', body: 'x' });
        const partial = yield* make({ title: 'meridian notes', body: 'the quarry stands' });
        const neither = yield* make({ title: 'plain notes', body: 'meridian and quarry in the body' });
        expect(yield* found({ query: 'meridian quarry', projectId })).toEqual([both, partial, neither]);
      }),
    ),
  );

  it.effect('the identity that ends in those characters comes before the ones that merely hold them', () =>
    withLens(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const fragment = 'beef';
        const named = 'abcdbeef';
        for (const [uuid, title] of [
          ['01a03991-45fa-70d8-ac24-1ab3abcdbeef', 'ends in it'],
          ['01a03991-45fa-70d8-ac24-1ab1beef234a', 'merely holds it'],
        ] as const) {
          const row = yield* graph.blocks.create({ projectId, tags: ['idea'], title, parentId: root });
          yield* graph.graphStore.db.update(block).set({ uuid }).where(eq(block.id, row.id));
        }
        const order = (yield* graph.ranking.search({ query: fragment, projectId })).items.map((hit) => hit.name);
        expect(order).toContain(named);
        const ending = order.findIndex((name) => name.endsWith(fragment));
        const inside = order.findIndex((name) => !name.endsWith(fragment) && name.includes(fragment));
        expect(ending).toBeGreaterThan(-1);
        expect(inside).toBeGreaterThan(-1);
        expect(ending).toBeLessThan(inside);
      }),
    ),
  );

  it.effect('a page is cut at the caller’s figure and the total counts every match behind it', () =>
    withLens(({ graph, projectId }) =>
      Effect.gen(function* () {
        const page = yield* graph.ranking.search({ query: WORD, projectId, limit: PAGE });
        expect(page.items).toHaveLength(PAGE);
        expect(page.total).toBe(PLANTED * 3);
      }),
    ),
  );

  it.effect('a caller who names no page gets the agent default, and never more than the ceiling', () =>
    withLens(({ graph, projectId }) =>
      Effect.gen(function* () {
        const page = yield* graph.ranking.search({ query: WORD, projectId });
        expect(page.items).toHaveLength(Math.min(pageRows(undefined, BLOCKS, ceilingOf(BLOCKS)), PLANTED * 3));
        const asked = yield* graph.ranking.search({ query: WORD, projectId, limit: ceilingOf(BLOCKS) + 500 });
        expect(asked.items.length).toBeLessThanOrEqual(ceilingOf(BLOCKS));
      }),
    ),
  );

  it.effect('a figure past the ceiling is cut at the ceiling the family derives', () =>
    withLens(({ graph, projectId, found, root }) =>
      Effect.gen(function* () {
        const many = 'rhodonite';
        const token = 'seedparity';
        const past = ceilingOf(BLOCKS) + 1;
        const seed = yield* graph.blocks.create({ projectId, title: `${many} ${token} original`, parentId: root });
        const row = yield* graph.blocks.rawBlockById(seed.id);
        const [copy] = yield* graph.graphStore.db
          .insert(block)
          .values(
            Array.from({ length: past - 1 }, (_, index) => ({
              ...row,
              id: undefined,
              uuid: randomUUID(),
              title: index === 0 ? `${many} ${token} copy` : `${many} ${index}`,
              ord: index + 1,
            })),
          )
          .returning({ id: block.id });
        yield* graph.blockProjection.completeDerived('types');
        const body = yield* graph.blocks.create({ projectId, title: 'parity control', body: token, parentId: root });
        const before = yield* found({ query: token, projectId });
        yield* Effect.sleep('2 millis');
        yield* graph.blocks.update({ id: seed.id, title: `${many} ${token} refreshed` });
        const after = yield* found({ query: token, projectId });
        expect([before, after]).toEqual([
          [copy!.id, seed.id, body.id],
          [seed.id, copy!.id, body.id],
        ]);
        const page = yield* graph.ranking.search({ query: many, projectId, limit: ceilingOf(BLOCKS) + 500 });
        expect(page.items).toHaveLength(ceilingOf(BLOCKS));
        expect(page.total).toBe(past);
      }),
    ),
  );

  it.effect('the walk yields every match exactly once and never climbs back up a tier', () =>
    withLens(({ walkSearch }) =>
      Effect.gen(function* () {
        const hits = yield* walkSearch(WORD, PAGE);
        expect(hits).toHaveLength(PLANTED * 3);
        expect(new Set(hits.map((hit) => hit.name)).size).toBe(PLANTED * 3);
        const tierOf = (title: string) => (title.startsWith(`${WORD} `) ? 0 : title.startsWith(`${WORD}stone `) ? 1 : 2);
        const tiers = hits.map((hit) => tierOf(hit.title));
        expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
      }),
    ),
  );

  it.effect('an unreadable cursor is refused with a way back to the first page', () =>
    withLens(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const refused = yield* refusal(graph.ranking.search({ query: WORD, projectId, cursor: 'not-a-cursor' }));
        expect(refused.code).toBe('bad-cursor');
        expect(refused.unblock.length).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect('a cursor handed to another question is refused stale rather than walked', () =>
    withLens(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const first = yield* graph.ranking.search({ query: WORD, projectId, limit: 5 });
        expect(first.nextCursor).not.toBeNull();
        const refused = yield* refusal(
          graph.ranking.search({ query: 'palladium', projectId, cursor: first.nextCursor ?? undefined, limit: 5 }),
        );
        expect(refused.code).toBe('cursor-stale');
        expect(refused.unblock.length).toBeGreaterThan(0);
      }),
    ),
  );

  it.effect('a selection walk yields every match exactly once, in the sort asked', () =>
    withLens(({ make, nameOf, walkSelection }) =>
      Effect.gen(function* () {
        const area = yield* make({ title: 'tourmaline area', tag: 'zone' });
        const planted: number[] = [];
        for (let index = 0; index < 3; index += 1) planted.push(yield* make({ title: `tourmaline ${index}`, parentId: area }));
        const { names, totals } = yield* walkSelection({ scope: [yield* nameOf(area)], sort: created, limit: 3 });
        expect(totals).toEqual(new Set([planted.length + 1]));
        expect(names).toEqual(yield* Effect.forEach([area, ...planted], nameOf));
      }),
    ),
  );

  it.effect('the ended walk yields every match exactly once, rows that never ended last', () =>
    withLens(({ graph, make, nameOf, walkSelection }) =>
      Effect.gen(function* () {
        const area = yield* make({ title: 'jasper area', tag: 'zone' });
        const finished: number[] = [];
        for (let index = 0; index < 2; index += 1) {
          const id = yield* make({ title: `jasper done ${index}`, tag: 'task', parentId: area });
          yield* graph.tasks.claim({ id });
          yield* graph.tasks.finish({ id });
          finished.push(id);
        }
        const open: number[] = [];
        for (let index = 0; index < 2; index += 1) open.push(yield* make({ title: `jasper open ${index}`, tag: 'task', parentId: area }));
        const { names, totals } = yield* walkSelection({
          scope: [yield* nameOf(area)],
          includeResting: true,
          sort: { by: 'ended', order: 'desc' },
          limit: 2,
        });
        const total = finished.length + open.length + 1;
        expect(totals).toEqual(new Set([total]));
        expect(names).toHaveLength(total);
        expect(new Set(names).size).toBe(total);
        expect(new Set(names.slice(0, finished.length))).toEqual(new Set(yield* Effect.forEach(finished, nameOf)));
        expect(new Set(names.slice(finished.length))).toEqual(new Set(yield* Effect.forEach([area, ...open], nameOf)));
      }),
    ),
  );

  it.effect('a cursor taken under one sort or one narrowing is stale under another, and an unreadable cursor is bad-cursor', () =>
    withLens(({ graph, projectId, make, nameOf, refusal }) =>
      Effect.gen(function* () {
        const area = yield* make({ title: 'zircon area', tag: 'zone' });
        yield* make({ title: 'zircon child', parentId: area });
        const other = yield* make({ title: 'zircon elsewhere', tag: 'zone' });
        yield* make({ title: 'zircon stranger', parentId: other });
        const scope = [yield* nameOf(area)];
        const first = yield* graph.selection.queryPage(projectId, { scope, sort: { by: 'updated', order: 'desc' }, limit: 1 });
        expect(first.nextCursor).not.toBeNull();
        const sorted = yield* refusal(
          graph.selection.queryPage(projectId, { scope, sort: created, limit: 1 }, first.nextCursor ?? undefined),
        );
        expect(sorted.code).toBe('cursor-stale');
        const narrowed = yield* refusal(
          graph.selection.queryPage(
            projectId,
            { scope: [yield* nameOf(other)], sort: { by: 'updated', order: 'desc' }, limit: 1 },
            first.nextCursor ?? undefined,
          ),
        );
        expect(narrowed.code).toBe('cursor-stale');
        expect((yield* refusal(graph.selection.queryPage(projectId, { sort: created }, 'not-a-cursor'))).code).toBe('bad-cursor');
      }),
    ),
  );

  it.effect('a tag filter answers with that tag alone, and a scope answers with its subtree, the block that names it included', () =>
    withLens(({ projectId, make, found }) =>
      Effect.gen(function* () {
        const doc = yield* make({ title: 'trebuchet doc' });
        const spec = yield* make({ title: 'trebuchet spec', tag: 'spec' });
        expect(yield* found({ query: 'trebuchet', projectId, tag: 'spec' })).toEqual([spec]);
        expect(yield* found({ query: 'trebuchet', projectId, tag: 'idea' })).toEqual([doc]);
        const area = yield* make({ title: 'catapult area', tag: 'zone' });
        const child = yield* make({ title: 'catapult child', parentId: area });
        yield* make({ title: 'catapult stranger' });
        expect((yield* found({ query: 'catapult', projectId, scopeId: area })).sort()).toEqual([area, child].sort());
      }),
    ),
  );

  it.effect('another project never answers this one query', () =>
    withLens(({ graph, projectId, fixture, make, found }) =>
      Effect.gen(function* () {
        const mine = yield* make({ title: 'ballista doc' });
        const other = yield* graph.projectLifecycle.create({ name: 'ranking-other', rootPath: yield* fixture.directory('ranking-other') });
        const otherRoot = yield* graph.blocks.rootBlockOf(other.id);
        const theirs = yield* graph.blocks.create({
          projectId: other.id,
          tags: ['idea'],
          title: 'ballista elsewhere',
          parentId: otherRoot.id,
        });
        expect(yield* found({ query: 'ballista', projectId })).toEqual([mine]);
        expect(yield* found({ query: 'ballista', projectId: other.id })).toEqual([theirs.id]);
      }),
    ),
  );

  it.effect('a trashed block leaves the answer and a restored one comes back', () =>
    withLens(({ graph, projectId, make, found }) =>
      Effect.gen(function* () {
        const id = yield* make({ title: 'culverin doc' });
        yield* graph.trash.delete({ id });
        expect(yield* found({ query: 'culverin', projectId })).toEqual([]);
        yield* graph.trash.restore({ id });
        expect(yield* found({ query: 'culverin', projectId })).toEqual([id]);
      }),
    ),
  );

  it.effect('finished work rests: off the default page, on the one that names its status', () =>
    withLens(({ graph, projectId, make, found }) =>
      Effect.gen(function* () {
        const open = yield* make({ title: 'halberd open', tag: 'task' });
        const done = yield* make({ title: 'halberd done', tag: 'task' });
        const closed = yield* make({ title: 'halberd closed', tag: 'task' });
        yield* graph.tasks.claim({ id: done });
        yield* graph.tasks.finish({ id: done });
        yield* graph.tasks.claim({ id: closed });
        yield* graph.tasks.close({ id: closed, reason: 'answered elsewhere' });
        expect(yield* found({ query: 'halberd', projectId })).toEqual([open]);
        expect(yield* found({ query: 'halberd', projectId, status: 'done' })).toEqual([done]);
        expect(yield* found({ query: 'halberd', projectId, status: 'closed' })).toEqual([closed]);
      }),
    ),
  );

  it.effect('a replaced block rests: the successor answers the words they share, history reveals what the page leaves out', () =>
    withLens(({ graph, projectId, make, found }) =>
      Effect.gen(function* () {
        const retiredDoc = yield* make({ title: 'onager retired', tag: 'explanation' });
        const currentDoc = yield* make({ title: 'onager current', tag: 'explanation' });
        yield* graph.standing.supersede({ oldId: retiredDoc, withId: currentDoc });
        const retiredSpec = yield* make({ title: 'onager decided', tag: 'spec' });
        const heirSpec = yield* make({ title: 'onager redecided', tag: 'spec' });
        yield* graph.standing.supersede({ oldId: retiredSpec, withId: heirSpec });
        expect((yield* found({ query: 'onager', projectId })).toSorted()).toEqual([currentDoc, heirSpec].toSorted());
        expect(yield* found({ query: 'onager', projectId, status: 'open' })).toEqual([heirSpec]);
        const retired = yield* make({ title: 'mangonel retired' });
        const current = yield* make({ title: 'mangonel current' });
        yield* graph.standing.supersede({ oldId: retired, withId: current });
        expect(yield* found({ query: 'mangonel', projectId })).toEqual([current]);
        expect((yield* found({ query: 'mangonel', projectId, history: true })).toSorted()).toEqual([retired, current].toSorted());
      }),
    ),
  );

  it.effect('a name-shaped query answers a replaced block', () =>
    withLens(({ graph, projectId, make, found, nameOf }) =>
      Effect.gen(function* () {
        const retired = yield* make({ title: 'scorpio retired' });
        const current = yield* make({ title: 'scorpio current' });
        yield* graph.standing.supersede({ oldId: retired, withId: current });
        expect(yield* found({ query: yield* nameOf(retired), projectId })).toEqual([retired]);
      }),
    ),
  );
});
