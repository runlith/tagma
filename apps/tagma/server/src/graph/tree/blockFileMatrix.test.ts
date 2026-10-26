import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type BlockFile, type BlockFrontmatter, decodeBlockFile, encodeBlockFile } from './blockFile.js';

const ID = '0198dddd-0000-7000-8000-00000000ee01';
const base = (over: Partial<BlockFrontmatter> = {}, body = ''): BlockFile => ({
  frontmatter: { id: ID, tags: ['idea'], title: 'plain', ord: 1, ...over },
  body,
});
const roundtrip = (file: BlockFile) => decodeBlockFile(encodeBlockFile(file));

describe('block file boundary matrix', () => {
  it.effect('titles that fight the YAML grammar survive verbatim', () =>
    Effect.gen(function* () {
      const titles = [
        'plain words',
        'a colon: right here',
        '  leading and trailing spaces  ',
        '"double quoted"',
        "single 'quotes' inside",
        '- opens like a list item',
        '# opens like a comment',
        '{braces} and [brackets]',
        'a | pipe and a > fold',
        'yes',
        'null',
        'true',
        '42',
        '3.14',
        '2023-12',
        '007',
        '~',
        '*anchor and &ref',
        'два языка in one title',
        'tab\tinside',
        'ends with a colon:',
        '@at and `backtick`',
        '!bang and %percent',
      ];
      for (const title of titles) expect((yield* roundtrip(base({ title }))).frontmatter.title).toBe(title);
    }),
  );

  it.effect('bodies survive byte-true regardless of their framing or markup', () =>
    Effect.gen(function* () {
      const bodies = [
        '',
        'two\nlines',
        'ends with newline\n',
        '---\na fence-looking line inside the body\n---',
        '```yaml\nkey: value\n```',
        'unicode: продукт работает',
        '   indented\n\tand tabbed',
        'a [[reference]] and a [[dead:L-4|label]]',
        '\n\nleading blank lines',
      ];
      for (const body of bodies) expect((yield* roundtrip(base({}, body))).body).toBe(body);
    }),
  );

  it.effect('numeric ordering, open fields, tags, edges and source paths cross whole', () =>
    Effect.gen(function* () {
      const cases: Partial<BlockFrontmatter>[] = [
        { ord: 2.5 },
        { ord: -1 },
        { tags: [] },
        { tags: ['idea', 'area'] },
        { fields: { status: 'in_work', holder: 7, enabled: false, ops: [{ op: 'edit', old: 'a', new: 'b' }] } },
        {
          edges: [
            { kind: 'waits-on', to: '0198dddd-0000-7000-8000-00000000ee03' },
            { kind: 'implements', to: '0198dddd-0000-7000-8000-00000000ee02' },
          ],
        },
        { sources: [{ kind: 'dir', ref: 'src/some dir' }] },
      ];
      for (const over of cases) {
        const file = base(over);
        expect((yield* roundtrip(file)).frontmatter).toEqual(file.frontmatter);
      }
    }),
  );

  it.effect('missing identity and malformed tags, edges or sources refuse at the boundary', () =>
    Effect.gen(function* () {
      const refused = [
        '---\ntitle: x\nord: 1\n---\n',
        `---\nid: ${ID}\ntitle: x\nord: 1\ntags: [""]\n---\n`,
        `---\nid: ${ID}\ntitle: x\nord: 1\nedges:\n  - kind: relates\n    to: ""\n---\n`,
        `---\nid: ${ID}\ntitle: x\nord: 1\nsources:\n  - kind: page\n    ref: a\n---\n`,
      ];
      for (const text of refused) expect((yield* Effect.flip(decodeBlockFile(text))).reason).toBe('frontmatter-shape');
    }),
  );
});
