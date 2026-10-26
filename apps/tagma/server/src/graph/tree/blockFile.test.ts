import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type BlockFile, type BlockFrontmatter, blockFrontmatterOf, decodeBlockFile, encodeBlockFile } from './blockFile.js';
import { farOf, farText } from '../contract/wire/far.js';

const full: BlockFrontmatter = {
  id: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e77',
  title: 'Voxel storage: chunk columns with a palette',
  ord: 2.5,
  tags: ['spec'],
  fields: { status: 'open', layout: { mode: 'list', filters: ['a', 'b'] } },
  edges: [{ kind: 'reviews', to: '0198c3d4-7b2a-7f00-8000-aaaaaaaaaaaa' }],
  sources: [
    { kind: 'file', ref: 'apps/tagma/server/src/db/schema.ts' },
    { kind: 'symbol', ref: 'apps/tagma/server/src/db/Store.ts', symbol: 'Store' },
  ],
};

const roundTrip = (file: BlockFile) => decodeBlockFile(encodeBlockFile(file));

describe('block file codec', () => {
  it.effect('a full block round-trips value-identical, body and re-encoding byte-identical', () =>
    Effect.gen(function* () {
      const body = '# Heading\n\nRussian data: пример.\n\n---\n\na body may hold its own fence lines\n';
      const text = encodeBlockFile({ frontmatter: full, body });
      const back = yield* decodeBlockFile(text);
      expect(back.frontmatter).toEqual(full);
      expect(back.body).toBe(body);
      expect(encodeBlockFile(back)).toBe(text);
    }),
  );

  it.effect('a minimal block keeps its optional keys absent, not null', () =>
    Effect.gen(function* () {
      const minimal: BlockFrontmatter = { id: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e78', title: 'Images Without a Table', ord: 1 };
      const back = yield* roundTrip({ frontmatter: minimal, body: '' });
      expect(back.frontmatter).toEqual(minimal);
      expect(back.body).toBe('');
    }),
  );

  test('a block written from two stores holding its edges in different row orders serializes to the same bytes', () => {
    const edges = [
      { kind: 'amends', to: '0198c3d4-7b2a-7f00-8000-cccccccccccc' },
      { kind: 'discovered-from', to: '0198c3d4-7b2a-7f00-8000-bbbbbbbbbbbb' },
      { kind: 'discovered-from', to: '0198c3d4-7b2a-7f00-8000-aaaaaaaaaaaa' },
    ] as const;
    const row = { id: full.id, title: full.title, ord: 1, tags: ['proposal'], fields: {}, sources: [] };
    const written = (order: readonly (typeof edges)[number][]) =>
      encodeBlockFile({ frontmatter: blockFrontmatterOf({ ...row, edges: order }), body: 'x' });
    expect(written([edges[2], edges[0], edges[1]])).toBe(written(edges));
  });

  it.effect('a block with unresolved merge markers refuses for the marker sizes git supports', () =>
    Effect.gen(function* () {
      for (const size of [3, 7, 9]) {
        const file = encodeBlockFile({
          frontmatter: full,
          body: `${'<'.repeat(size)} ours\nleft\n${'='.repeat(size)}\nright\n${'>'.repeat(size)} theirs\n`,
        });
        expect((yield* Effect.flip(decodeBlockFile(file, size))).reason).toBe('conflict-markers');
      }
      const quoted = encodeBlockFile({ frontmatter: full, body: '> quoted knowledge\n' });
      expect((yield* decodeBlockFile(quoted, 3)).body).toBe('> quoted knowledge\n');
    }),
  );

  it.effect('malformed framing, YAML and frontmatter refuse by condition', () =>
    Effect.gen(function* () {
      const cases = [
        ['id: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\n', 'frontmatter-missing'],
        ['---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\n', 'frontmatter-unterminated'],
        ['---\nid: [unclosed\n---\n', 'frontmatter-yaml'],
        ['---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\nord: one\n---\n', 'frontmatter-shape'],
        ['---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\nord: 1\nstatuz: open\n---\n', 'frontmatter-shape'],
      ] as const;
      for (const [text, reason] of cases) expect((yield* Effect.flip(decodeBlockFile(text))).reason).toBe(reason);
    }),
  );

  it.effect('a fence closing at end-of-file reads as an empty body', () =>
    Effect.gen(function* () {
      const back = yield* decodeBlockFile('---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\nord: 1\n---');
      expect(back.body).toBe('');
      expect(back.frontmatter.id).toBe('0198c3d4-7b2a-7f00-8000-3f9ac2b41e79');
    }),
  );

  it.effect('CRLF fences decode, and the body stays verbatim', () =>
    Effect.gen(function* () {
      const back = yield* decodeBlockFile('---\r\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\r\ntitle: t\r\nord: 1\r\n---\r\nbody line\r\n');
      expect(back.frontmatter.id).toBe('0198c3d4-7b2a-7f00-8000-3f9ac2b41e79');
      expect(back.body).toBe('body line\r\n');
    }),
  );

  it.effect('an edge into another graph keeps its address, label included, through the codec', () =>
    Effect.gen(function* () {
      const far = {
        graph: '01a0bf97-a4f7-7e8b-bc09-a20c4d2ff254',
        uuid: '0198c3d4-7b2a-7f00-8000-dddddddddddd',
        label: 'backend: заказы #2',
      };
      const text = encodeBlockFile({ frontmatter: { ...full, edges: [{ kind: 'waits-on', to: farText(far) }] }, body: '' });
      const back = yield* decodeBlockFile(text);
      expect(farOf(back.frontmatter.edges?.[0]?.to ?? '')).toEqual(far);
      expect(encodeBlockFile(back)).toBe(text);
      expect(farOf(full.edges![0]!.to)).toBeNull();
    }),
  );

  test('fields serialize independent of key insertion order', () => {
    const one = { frontmatter: { ...full, fields: { b: 1, a: { y: [1, 2], x: 'v' } } }, body: '' };
    const other = { frontmatter: { ...full, fields: { a: { x: 'v', y: [1, 2] }, b: 1 } }, body: '' };
    expect(encodeBlockFile(one)).toBe(encodeBlockFile(other));
  });

  test('changing one map entry changes one line, not the fields document', () => {
    const modules = (entry: string) => ({
      frontmatter: { ...full, fields: { modules: { first: { entry: 'x' }, second: { entry } } } },
      body: '',
    });
    const before = encodeBlockFile(modules('x')).split('\n');
    const after = encodeBlockFile(modules('y')).split('\n');
    expect(after.length).toBe(before.length);
    expect(after.filter((line, at) => line !== before[at]).length).toBe(1);
  });

  it.effect('fields written as one flow-style line decode to the same values', () =>
    Effect.gen(function* () {
      const text =
        '---\nid: 0198c3d4-7b2a-7f00-8000-3f9ac2b41e79\ntitle: t\nord: 1\nfields: {"status":"open","layout":{"mode":"list","filters":["a","b"]}}\n---\nbody\n';
      const back = yield* decodeBlockFile(text);
      expect(back.frontmatter.fields).toEqual({ status: 'open', layout: { mode: 'list', filters: ['a', 'b'] } });
      expect((yield* roundTrip(back)).frontmatter.fields).toEqual(back.frontmatter.fields);
    }),
  );

  it.effect('fields holding hostile text round-trip inside the frontmatter', () =>
    Effect.gen(function* () {
      const nasty = {
        note: 'line\n---\nfence',
        key: { '---': ['# not a comment', 'a: b', '"q"', '\\d+\\/x', 'пример'] },
        n: [0, -1.5, true, null],
      };
      const back = yield* roundTrip({ frontmatter: { ...full, fields: nasty }, body: 'after\n' });
      expect(back.frontmatter.fields).toEqual(nasty);
      expect(back.body).toBe('after\n');
    }),
  );
});
