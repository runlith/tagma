import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { event } from '../store/tables.js';
import { applyBodyDelta, bodyDelta, mergedMarkdown, revertBodyDelta } from './bodyDiff.js';
import { demoGraphLayer, type DemoOwners, withDemo } from '../../composition/testing/graphFixture.js';

test('a delta carries a body forward and back, whatever the edit', () => {
  const pairs: [string, string][] = [
    ['', 'born from nothing'],
    ['the whole body', ''],
    ['one two three', 'one TWO three'],
    ['alpha beta gamma', 'alpha gamma'],
    ['head tail', 'head middle tail'],
    ['Тело по-русски с термином anchor', 'Тело по-русски с термином anchor и хвостом'],
    ['emoji 🜂 in place', 'emoji 🜂🜁 in place'],
    ['aaa bbb aaa', 'aaa ccc aaa'],
    ['same', 'same'],
    ['abc', 'cba'],
    [
      Array.from({ length: 2048 }, (_, index) => ['a', 'b', 'c', 'd'][index % 4]).join('\n'),
      Array.from({ length: 2048 }, (_, index) => ['d', 'c', 'a', 'b'][(index * 7) % 4]).join('\n'),
    ],
  ];
  for (const [before, after] of pairs) {
    const delta = bodyDelta(before, after);
    expect(applyBodyDelta(before, delta)).toBe(after);
    expect(revertBodyDelta(after, delta)).toBe(before);
  }
});

test('a wholly rewritten document falls back to one reversible replacement', () => {
  const before = Array.from({ length: 1024 }, () => 'a').join('\n');
  const after = Array.from({ length: 1024 }, () => 'b').join('\n');
  const delta = bodyDelta(before, after);
  expect(delta).toEqual([{ at: 0, del: before, ins: after }]);
  expect(applyBodyDelta(before, delta)).toBe(after);
  expect(revertBodyDelta(after, delta)).toBe(before);
});

test('a stored delta still carries its body both ways', () => {
  const before = 'the old body says one thing\nand another';
  const after = 'the new body says two things\nand another\nplus a tail';
  const stored = [
    { at: 4, del: 'old', ins: 'new' },
    { at: 18, del: '', ins: 'tw' },
    { at: 19, del: 'ne', ins: '' },
    { at: 27, del: '', ins: 's' },
    { at: 39, del: '', ins: '\nplus a tail' },
  ];
  expect(applyBodyDelta(before, stored)).toBe(after);
  expect(revertBodyDelta(after, stored)).toBe(before);
});

test('a large rewrite retains shared text in its reversible delta and rendered body', () => {
  const { before, after } = rewrite(200_000);
  const delta = bodyDelta(before, after);
  const merged = mergedMarkdown(before, after);

  expect(applyBodyDelta(before, delta)).toBe(after);
  expect(revertBodyDelta(after, delta)).toBe(before);
  expect(delta.reduce((sum, span) => sum + span.del.length + span.ins.length, 0)).toBeLessThan(before.length);
  const shown = merged
    .replaceAll(/<del>[\s\S]*?<\/del>/g, '')
    .replaceAll(/<\/?ins>/g, '')
    .split('\n')
    .filter((line) => line.length > 0);
  expect(shown).toEqual(after.split('\n'));
});

function rewrite(size: number): { before: string; after: string } {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const words = Array.from({ length: 500 }, (_, index) => `w${index.toString(36)}`);
  const lines: string[] = [];
  for (let length = 0; length < size; length += (lines.at(-1)?.length ?? 0) + 1) {
    lines.push(Array.from({ length: 12 }, () => words[Math.floor(next() * words.length)]).join(' '));
  }
  const rewritten = lines.flatMap((line) => {
    const roll = next();
    if (roll < 0.05) return [];
    if (roll < 0.1) return [line, `inserted ${line}`];
    if (roll < 0.6)
      return [
        line
          .split(' ')
          .map((word) => (next() < 0.3 ? `changed${word}` : word))
          .join(' '),
      ];
    return [line];
  });
  return { before: lines.join('\n'), after: rewritten.join('\n') };
}

test('the merged body keeps its markdown and marks whole words', () => {
  expect(mergedMarkdown('alpha beta gamma', 'alpha delta gamma')).toBe('alpha <del>beta</del><ins>delta</ins> gamma');
  expect(mergedMarkdown('- **Head**: old text', '- **Head**: new text')).toBe('- **Head**: <del>old</del><ins>new</ins> text');
  expect(mergedMarkdown('one\ntwo', 'one\ntwo\n- three')).toBe('one\ntwo\n- <ins>three</ins>');
  expect(mergedMarkdown('one\n- gone\ntwo', 'one\ntwo')).toBe('one\n- <del>gone</del>\ntwo');
});

test('a line that kept less than it changed reads as one replacement', () => {
  const rewritten = mergedMarkdown(
    '- **Периферия**: полоска в рамке рядом с wire vein — последняя запись журнала.',
    '- **Периферия**: плашка последней записи — в рамке.',
  );
  expect(rewritten.match(/<del>/g)).toHaveLength(1);
  expect(rewritten.match(/<ins>/g)).toHaveLength(1);
  expect(rewritten.startsWith('- <del>')).toBe(true);

  const touched = mergedMarkdown(
    '- **Лента**: маршрут `/journal` рядом с map и graph.',
    '- **Лента**: маршрут `/journal/[[id]]` рядом с map и graph.',
  );
  expect(touched).toBe('- **Лента**: маршрут <del>`/journal`</del><ins>`/journal/[[id]]`</ins> рядом с map и graph.');
});

test('marks never land inside code, references or fences', () => {
  expect(mergedMarkdown('call `oldName` now', 'call `newName` now')).toBe('call <del>`oldName`</del><ins>`newName`</ins> now');
  expect(mergedMarkdown('see [[L-12]] there', 'see [[L-34]] there')).toBe('see <del>[[L-12]]</del><ins>[[L-34]]</ins> there');
  const fenced = mergedMarkdown('```ts\nconst a = 1;\n```', '```ts\nconst a = 2;\n```');
  expect(fenced).toBe('```ts\nconst a = 2;\n```');
});

const newestOf = (graph: DemoOwners, blockId: number) => Effect.map(graph.journal.events({ blockId }), (rows) => rows[0]?.id ?? 0);

layer(demoGraphLayer())('graph history', (it) => {
  it.effect('a body is reconstructed at any journal position', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'd', body: 'first', parentId: root });
        const afterCreate = yield* newestOf(graph, id);
        yield* graph.blocks.update({ id, body: 'first and second' });
        const afterSecond = yield* newestOf(graph, id);
        yield* graph.blocks.update({ id, body: 'first and third' });

        expect(yield* graph.history.bodyAt(id, afterCreate)).toBe('first');
        expect(yield* graph.history.bodyAt(id, afterSecond)).toBe('first and second');
        expect(yield* graph.history.bodyAt(id, 10_000)).toBe('first and third');
        expect(yield* graph.history.bodyAt(id, 0)).toBeNull();
      }),
    ),
  );

  it.effect('an anchored edit reconstructs like any other write', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'd', body: 'alpha beta gamma', parentId: root });
        const before = yield* newestOf(graph, id);
        yield* graph.blocks.edit({ id, old: 'beta', new: 'delta' });
        expect(yield* graph.history.bodyAt(id, before)).toBe('alpha beta gamma');
        expect(yield* graph.history.bodyAt(id, 10_000)).toBe('alpha delta gamma');
      }),
    ),
  );

  it.effect('a body change with no delta reads as unknown, never as a guess', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'd', body: 'original', parentId: root });
        const born = yield* newestOf(graph, id);
        yield* graph.graphStore.db.insert(event).values({
          ts: new Date(yield* Clock.currentTimeMillis),
          op: 'update',
          blockId: id,
          payload: JSON.stringify({ chars: 8, wasChars: 12 }),
        });
        yield* graph.blocks.update({ id, body: 'rewritten' });

        expect(yield* graph.history.bodyAt(id, born)).toBeNull();
        const diff = yield* graph.history.blockDiff({ blockId: id, from: born, to: 10_000 });
        expect(diff.bodyUnknown).toBe(true);
        expect(diff.body).toBeNull();
      }),
    ),
  );

  it.effect('a stored payload no reader can decode refuses the diff, and a missing block refuses as not found', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'd', body: 'original', parentId: root });
        const born = yield* newestOf(graph, id);
        yield* graph.graphStore.db.insert(event).values({
          ts: new Date(yield* Clock.currentTimeMillis),
          op: 'update',
          blockId: id,
          payload: '{"chars":"many"',
        });
        expect((yield* demo.refusal(graph.history.blockDiff({ blockId: id, from: born, to: 10_000 }))).code).toBe('journal-unreadable');
        expect((yield* demo.refusal(graph.history.blockDiff({ blockId: 999_999, from: 0, to: 10_000 }))).code).toBe('not-found');
      }),
    ),
  );

  it.effect('a range diff carries the body chunks, the title pair and the status pair', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Old title', body: 'alpha beta', parentId: root });
        const from = yield* newestOf(graph, id);
        yield* graph.blocks.update({ id, title: 'New title', body: 'alpha gamma' });
        yield* graph.tasks.claim({ id });
        const to = yield* newestOf(graph, id);

        const diff = yield* graph.history.blockDiff({ blockId: id, from, to });
        expect(diff.bodyUnknown).toBe(false);
        expect(diff.body).toBe('alpha <del>beta</del><ins>gamma</ins>');
        expect(diff.title).toEqual({ from: 'Old title', to: 'New title' });
        expect(diff.status).toEqual({ from: 'open', to: 'in_work' });
        expect(diff.sessions).toEqual([null]);
      }),
    ),
  );

  it.effect('a block born inside the range reads as a whole insertion', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const from = (yield* graph.journal.events({ limit: 1 }))[0]?.id ?? 0;
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'fresh', body: 'brand new', parentId: root });
        const diff = yield* graph.history.blockDiff({ blockId: id, from, to: 10_000 });
        expect(diff.bodyUnknown).toBe(false);
        expect(diff.body).toBe('<ins>brand new</ins>');
      }),
    ),
  );

  it.effect('a reading mark resolves to the position that produced the seen body', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'd', body: 'first', parentId: root });
        const born = (yield* graph.journal.events({ blockId: id }))[0];
        const seen = (yield* graph.selection.records([id]))[0]?.updatedAt;
        expect(born).toBeDefined();
        expect(seen).toBeDefined();
        expect(seen!.getTime()).toBe(yield* Clock.currentTimeMillis);
        expect(born!.ts).toEqual(seen!);
        yield* TestClock.adjust('1 second');
        yield* graph.blocks.update({ id, body: 'first and second' });
        const changed = (yield* graph.selection.records([id]))[0]?.updatedAt;
        expect(changed?.getTime()).toBe(seen!.getTime() + 1_000);
        expect((yield* graph.journal.events({ blockId: id }))[0]?.ts).toEqual(changed);

        expect(yield* graph.history.positionAt(id, seen!)).toBe(born!.id);
        const from = yield* graph.history.positionAt(id, seen!);
        expect((yield* graph.history.blockDiff({ blockId: id, from, to: 10_000 })).body).toBe('first<ins> and second</ins>');
      }),
    ),
  );

  it.effect('marks name what happened to each block of the range', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const parent = (yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'area', parentId: root })).id;
        const kept = (yield* graph.blocks.create({ projectId, parentId: parent, tags: ['idea'], title: 'kept', body: 'a' })).id;
        const doomed = (yield* graph.blocks.create({ projectId, parentId: parent, tags: ['idea'], title: 'doomed' })).id;
        const elsewhere = (yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'elsewhere', parentId: root })).id;
        const from = (yield* graph.journal.events({ limit: 1 }))[0]?.id ?? 0;

        const born = (yield* graph.blocks.create({ projectId, parentId: parent, tags: ['idea'], title: 'born' })).id;
        yield* graph.blocks.update({ id: kept, body: 'a and b' });
        yield* graph.trash.delete({ id: doomed });
        yield* graph.blocks.update({ id: elsewhere, parentId: parent });

        const { marks } = yield* graph.history.marks({ projectId, scopeId: parent, from, to: 10_000 });
        const byName = new Map(marks.map((mark) => [mark.blockName, mark.mark]));
        expect(byName.get(yield* demo.nameOf(born))).toBe('added');
        expect(byName.get(yield* demo.nameOf(kept))).toBe('edited');
        expect(byName.get(yield* demo.nameOf(doomed))).toBe('deleted');
        expect(byName.get(yield* demo.nameOf(elsewhere))).toBe('moved');
        expect(byName.has(yield* demo.nameOf(parent))).toBe(false);
      }),
    ),
  );

  it.effect(
    "a scope's marks read only the entries concerning it, a link into it from outside included, and a link written without its target reads",
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId, root } = demo;
          const parent = (yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'scope', parentId: root })).id;
          const inside = (yield* graph.blocks.create({ projectId, parentId: parent, tags: ['idea'], title: 'inside' })).id;
          const outside = (yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'outside', parentId: root })).id;
          const from = (yield* graph.journal.events({ limit: 1 }))[0]?.id ?? 0;
          const ts = new Date(yield* Clock.currentTimeMillis);
          yield* graph.graphStore.db.insert(event).values({ ts, op: 'link', blockId: outside, projectId, payload: '{"toId":' });
          yield* graph.graphStore.db.insert(event).values({ ts, op: 'link', blockId: inside, projectId, payload: '{"kind":"relates"}' });
          yield* graph.edges.link({ fromId: outside, kind: 'relates', toId: inside });

          const { marks } = yield* graph.history.marks({ projectId, scopeId: parent, from, to: 10_000 });
          expect(marks.map((mark) => mark.blockName).sort()).toEqual([yield* demo.nameOf(inside)]);
          expect(marks[0]?.entries).toBe(2);
          const diff = yield* graph.history.blockDiff({ blockId: inside, from, to: 10_000 });
          expect(diff.changes).toContainEqual(expect.objectContaining({ kind: 'link', peerName: null }));
        }),
      ),
  );
});
