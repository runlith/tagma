import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { batchDocument } from '../contract/wire/batch.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const PAGE = 2;

const lens = (demo: EffectDemo) => {
  const { graph, projectId, root } = demo;
  const hits = (input: Parameters<EffectDemo['graph']['ranking']['search']>[0]) =>
    Effect.flatMap(graph.ranking.search(input), (page) =>
      Effect.forEach(page.items, (item) => Effect.map(graph.blockNames.idOfName(item.name), (id) => ({ ...item, id }))),
    );
  const found = (input: Parameters<EffectDemo['graph']['ranking']['search']>[0]) =>
    Effect.map(hits(input), (rows) => rows.map((row) => row.id));
  const make = (tag: string, title: string, body?: string) =>
    Effect.map(graph.blocks.create({ projectId, tags: [tag], title, body, parentId: root }), (row) => row.id);
  return { ...demo, hits, found, make };
};

const withLens = <A, E, R>(body: (given: ReturnType<typeof lens>) => Effect.Effect<A, E, R>) => withDemo((demo) => body(lens(demo)));

layer(demoGraphLayer(), { excludeTestServices: true })('search', (it) => {
  it.effect('a body references a block the same batch creates after it', () =>
    withLens(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const rootName = yield* nameOf(root);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'first', tags: ['idea'], title: 'first', body: 'смотри [[$second]]', parentId: rootName },
            { op: 'create', $id: 'second', tags: ['idea'], title: 'second', parentId: rootName },
          ]),
          projectId,
        );
        const first = result.ids.first as string;
        const second = result.ids.second as string;
        expect((yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(first))).body).toBe(`смотри [[${second}]]`);
        expect((yield* graph.reading.show(yield* graph.blockNames.idOfName(second), 0)).refsIn).toEqual([first]);
      }),
    ),
  );

  it.effect('a labelled reference indexes the same edge as a bare one', () =>
    withLens(({ graph, make, nameOf }) =>
      Effect.gen(function* () {
        const target = yield* make('spec', 'цель');
        const targetName = yield* nameOf(target);
        const source = yield* make('idea', 'источник', `подключается к [[${targetName}|цели]] и к [[${targetName}]]`);
        expect((yield* graph.reading.show(source, 0)).refsOut).toEqual([targetName]);
        expect((yield* graph.reading.show(target, 0)).refsIn).toEqual([yield* nameOf(source)]);
      }),
    ),
  );

  it.effect('a body naming an undeclared handle refuses the whole batch, and a labelled handle is rewritten with its label kept', () =>
    withLens(({ graph, projectId, hits, refusal, nameOf, root }) =>
      Effect.gen(function* () {
        const rootName = yield* nameOf(root);
        const lone = yield* refusal(
          graph.batch.apply(
            batchDocument([{ op: 'create', tags: ['idea'], title: 'lone', body: 'смотри [[$missing]]', parentId: rootName }]),
            projectId,
          ),
        );
        expect(lone.code).toBe('batch-ref');
        expect((yield* hits({ query: 'lone', projectId })).filter((row) => row.title === 'lone')).toEqual([]);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'hub', tags: ['idea'], title: 'hub', body: 'read [[$leaf|the leaf]] and [[$leaf]]', parentId: rootName },
            { op: 'create', $id: 'leaf', tags: ['idea'], title: 'leaf', parentId: rootName },
          ]),
          projectId,
        );
        const leaf = result.ids.leaf;
        const hub = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(result.ids.hub as string));
        expect(hub.body).toBe(`read [[${leaf}|the leaf]] and [[${leaf}]]`);
        const labelled = yield* refusal(
          graph.batch.apply(
            batchDocument([{ op: 'create', tags: ['idea'], title: 'lone', body: 'see [[$missing|a label]]', parentId: rootName }]),
            projectId,
          ),
        );
        expect(labelled.code).toBe('batch-ref');
      }),
    ),
  );

  it.effect('a russian word finds its declensions, and a path finds its owner', () =>
    withLens(({ graph, projectId, found, make }) =>
      Effect.gen(function* () {
        const id = yield* make(
          'idea',
          'Журнал обучения',
          'Событий журнала касаются все проекции; писать в него может только `JournalIngress`.',
        );
        yield* graph.sources.attach({ blockId: id, kind: 'dir', ref: 'server/src/learning/journal' });
        for (const query of ['обучение', 'журнал', 'проекция', 'server/src/learning/journal', 'JournalIngress', 'журнал обучение']) {
          expect(yield* found({ query, projectId })).toEqual([id]);
        }
        expect(yield* found({ query: 'журнал комикс', projectId })).toEqual([]);
      }),
    ),
  );

  it.effect('one block mixing languages answers each token by its script', () =>
    withLens(({ projectId, found, make }) =>
      Effect.gen(function* () {
        const id = yield* make('idea', 'Storage layer', 'Хранилищем владеет один сервер.');
        for (const query of ['storage', 'хранилище', 'storage хранилище']) {
          expect(yield* found({ query, projectId })).toEqual([id]);
        }
      }),
    ),
  );

  it.effect('an english word finds its other forms, and a chinese query finds its words', () =>
    withLens(({ projectId, found, make }) =>
      Effect.gen(function* () {
        const id = yield* make('idea', 'Trips to Montenegro', '黑山旅游怎么样');
        expect(yield* found({ query: 'trip', projectId })).toEqual([id]);
        expect(yield* found({ query: '黑山旅游', projectId })).toEqual([id]);
        expect(yield* found({ query: '黑山 东京', projectId })).toEqual([]);
      }),
    ),
  );

  it.effect('an empty query enumerates the project and filters narrow it', () =>
    withLens(({ graph, projectId, found, make }) =>
      Effect.gen(function* () {
        const specId = yield* make('spec', 'искомая спека');
        const taskId = yield* make('task', 'задача рядом');
        yield* graph.tasks.claim({ id: taskId });
        expect(yield* found({ query: '', projectId })).toEqual(expect.arrayContaining([specId, taskId]));
        expect(yield* found({ query: '', projectId, tag: 'spec' })).toEqual([specId]);
        expect(yield* found({ query: '', projectId, status: 'in_work' })).toEqual([taskId]);
        expect(yield* found({ query: 'искомая', projectId })).toEqual([specId]);
      }),
    ),
  );

  it.effect('a name query names its block before any text that mentions it', () =>
    withLens(({ projectId, found, make, nameOf }) =>
      Effect.gen(function* () {
        const target = yield* make('spec', 'цель поиска');
        const targetName = yield* nameOf(target);
        const mention = yield* make('idea', 'упоминание', `см. [[${targetName}]]`);
        for (const query of [targetName, targetName.toUpperCase()]) {
          const ids = yield* found({ query, projectId });
          expect(ids[0]).toBe(target);
          expect(ids).toContain(mention);
        }
        expect(yield* found({ query: targetName.slice(-4), projectId })).toContain(target);
      }),
    ),
  );

  it.effect('a word typed with a typo finds its block when nothing matches as typed, and the page says it is approximate', () =>
    withLens(({ graph, projectId, found, make }) =>
      Effect.gen(function* () {
        const ids = [
          yield* make('idea', 'Kaleidoscope one'),
          yield* make('idea', 'Kaleidoscope two'),
          yield* make('idea', 'Kaleidoscope three'),
        ];
        const first = yield* graph.ranking.search({ query: 'kaleidoscpoe', projectId, limit: 2 });
        const rest = yield* graph.ranking.search({ query: 'kaleidoscpoe', projectId, limit: 2, cursor: first.nextCursor ?? undefined });
        expect([first.approximate, first.total, rest.approximate, rest.nextCursor]).toEqual([true, 3, true, null]);
        const named = yield* Effect.forEach([...first.items, ...rest.items], (item) => graph.blockNames.idOfName(item.name));
        expect(named.toSorted()).toEqual(ids.toSorted());
        expect((yield* graph.ranking.search({ query: 'kaleidoscope', projectId })).approximate).toBe(false);
      }),
    ),
  );

  it.effect('a title match outranks a body match, and fresher wins inside a tier', () =>
    withLens(({ projectId, found, make }) =>
      Effect.gen(function* () {
        const bodyHit = yield* make('idea', 'другое имя', 'хранилище упомянуто в теле');
        const titleHit = yield* make('idea', 'Хранилище');
        expect(yield* found({ query: 'хранилище', projectId })).toEqual([titleHit, bodyHit]);
      }),
    ),
  );

  it.effect('an empty query lists the freshest first, and a query shorter than the index can see does too', () =>
    withLens(({ graph, projectId, found, make }) =>
      Effect.gen(function* () {
        const first = yield* make('task', 'старая задача');
        yield* make('task', 'новая задача');
        yield* Effect.sleep('2 millis');
        yield* graph.blocks.update({ id: first, title: 'старая задача, правленная' });
        expect((yield* found({ query: '', projectId }))[0]).toBe(first);
        const named = yield* make('idea', 'ab начало');
        yield* Effect.sleep('2 millis');
        const fresher = yield* make('task', 'ничего общего');
        const page = yield* found({ query: 'ab', projectId });
        expect(page[0]).toBe(fresher);
        expect(page).toContain(named);
      }),
    ),
  );

  it.effect('a page carries the caller’s figure, says how many matched, and the cursor walks the rest', () =>
    withLens(({ graph, projectId, make }) =>
      Effect.gen(function* () {
        const written = PAGE + 1;
        for (let index = 0; index < written; index += 1) yield* make('idea', `страница ${index}`);
        const first = yield* graph.ranking.search({ query: 'страница', projectId, limit: PAGE });
        expect(first.items).toHaveLength(PAGE);
        expect(first.total).toBe(written);
        const second = yield* graph.ranking.search({ query: 'страница', projectId, cursor: first.nextCursor ?? undefined, limit: PAGE });
        expect(second.items).toHaveLength(1);
        expect(second.nextCursor).toBeNull();
        expect(new Set([...first.items, ...second.items].map((hit) => hit.name)).size).toBe(written);
      }),
    ),
  );

  it.effect('--path selects the blocks with a source in a place, not the ones mentioning it', () =>
    withLens(({ graph, projectId, found, make }) =>
      Effect.gen(function* () {
        const sourced = yield* make('idea', 'the reader');
        yield* graph.sources.attach({ blockId: sourced, kind: 'file', ref: 'src/reader.ts' });
        const mentions = yield* make('idea', 'a note', 'Look at src/reader.ts one day.');
        expect(yield* found({ query: 'src/reader.ts', projectId })).toContain(mentions);
        expect(yield* found({ query: '', projectId, path: 'src/reader.ts' })).toEqual([sourced]);
        expect(yield* found({ query: '', projectId, path: 'src' })).toEqual([sourced]);
      }),
    ),
  );

  it.effect('a hit carries the first line of the body with its markdown markers off', () =>
    withLens(({ projectId, hits, make }) =>
      Effect.gen(function* () {
        const id = yield* make('idea', 'сниппет', '\n## Заголовок\nвторая строка');
        expect((yield* hits({ query: 'сниппет', projectId }))[0]).toMatchObject({ id, snippet: 'Заголовок' });
      }),
    ),
  );
});
