import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { decodeBlockFile } from './blockFile.js';
import { type TreeBlock, renderBlockTree, shelfNames } from './layout.js';
import { spokenId } from '../../platform/contract/wire/ids.js';

const uuid = (tail: string) => `0198eeee-0000-7000-8000-${tail.padStart(12, '0')}`;

describe('shelf names', () => {
  test('the first taker keeps the bare slug, ord order decides who that is', () => {
    const names = shelfNames([
      { id: uuid('b'), title: 'Charter', ord: 2 },
      { id: uuid('a'), title: 'Charter', ord: 1 },
    ]);
    expect(names.get(uuid('a'))).toBe('charter');
    expect(names.get(uuid('b'))).toBe(`charter-${spokenId(uuid('b'))}`);
  });

  test('equal ord falls back to id order, so the answer never depends on arrival', () => {
    const one = shelfNames([
      { id: uuid('2'), title: 'Twin', ord: 1 },
      { id: uuid('1'), title: 'Twin', ord: 1 },
    ]);
    const two = shelfNames([
      { id: uuid('1'), title: 'Twin', ord: 1 },
      { id: uuid('2'), title: 'Twin', ord: 1 },
    ]);
    expect(one.get(uuid('1'))).toBe('twin');
    expect(one).toEqual(two);
  });

  const slugCases: [title: string, expected: string][] = [
    ['Simple Words', 'simple-words'],
    ['CAPS AND lower', 'caps-and-lower'],
    ['punctuation, everywhere!', 'punctuation-everywhere'],
    ['  spaces  around  ', 'spaces-around'],
    ['numbers 42 stay', 'numbers-42-stay'],
    ['dash-already-there', 'dash-already-there'],
  ];
  for (const [title, expected] of slugCases) {
    test(`"${title}" slugs to "${expected}"`, () => {
      expect(shelfNames([{ id: uuid('1'), title, ord: 1 }]).get(uuid('1'))).toBe(expected);
    });
  }

  test('symbols and the reserved index name fall back to identity suffixes', () => {
    for (const title of ['###', 'Index']) {
      expect(shelfNames([{ id: uuid('1'), title, ord: 1 }]).get(uuid('1'))).toBe(spokenId(uuid('1')));
    }
  });

  test('a very long title truncates to a bounded slug', () => {
    const name = shelfNames([{ id: uuid('1'), title: 'word '.repeat(13), ord: 1 }]).get(uuid('1'));
    expect(name?.length).toBeLessThanOrEqual(60);
  });
});

it.effect('a nested render maps parents to indexes and leaves to files that decode to the original blocks', () =>
  Effect.gen(function* () {
    const A = uuid('a01');
    const B = uuid('b02');
    const C = uuid('c03');
    const blocks: TreeBlock[] = [
      { parentId: null, frontmatter: { id: A, tags: ['zone'], title: 'Root', ord: 1 }, body: '' },
      { parentId: A, frontmatter: { id: B, tags: ['zone'], title: 'Wing', ord: 1 }, body: '' },
      { parentId: B, frontmatter: { id: C, tags: ['idea'], title: 'Leaf', ord: 1 }, body: 'text' },
    ];
    const rendered = yield* renderBlockTree(blocks);
    expect(rendered.paths).toEqual(
      new Map([
        [A, 'root/index.md'],
        [B, 'root/wing/index.md'],
        [C, 'root/wing/leaf.md'],
      ]),
    );
    expect([...rendered.files.keys()].sort()).toEqual(['root/index.md', 'root/wing/index.md', 'root/wing/leaf.md']);
    const decoded = yield* Effect.forEach(rendered.files.values(), (text) => decodeBlockFile(text));
    expect(new Map(decoded.map((file) => [file.frontmatter.id, file]))).toEqual(
      new Map(blocks.map(({ frontmatter, body }) => [frontmatter.id, { frontmatter, body }])),
    );
  }),
);
