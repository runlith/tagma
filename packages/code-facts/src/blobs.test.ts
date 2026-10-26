import { describe, expect, it } from 'bun:test';
import { type ParseMemo, blobTree, parseAhead } from './blobs';
import { js } from './languages/adapters';
import { importEdges, pathsUnder } from './tree';

const script = "import { a } from './a';\n";
const markup = `<script lang="ts">\n${script}</script>\n`;
const objects = new Map([
  ['src/a.ts', 'blob-a'],
  ['src/one.ts', 'blob-script'],
  ['src/two.ts', 'blob-script'],
  ['src/view.svelte', 'blob-markup'],
]);
const texts = new Map([
  ['blob-a', ''],
  ['blob-script', script],
  ['blob-markup', markup],
]);
const files = ['src/one.ts', 'src/two.ts', 'src/view.svelte'];

describe('blobTree', () => {
  it('reads one directory prefix without unrelated sibling names', () => {
    const sorted = ['src/a.ts', 'src/a.ts.meta', 'src/a/deep.ts', 'src/a/other.ts', 'src/b.ts'];
    expect([...pathsUnder(sorted, 'src/a')]).toEqual(['src/a/deep.ts', 'src/a/other.ts']);
    expect([...pathsUnder(sorted, 'src/a.ts')]).toEqual(['src/a.ts']);
    expect([...pathsUnder(sorted, 'src/z')]).toEqual([]);
    expect([...pathsUnder(sorted)]).toEqual(sorted);
    expect([...(blobTree(objects, texts, new Map(), [js]).paths?.('src') ?? [])].sort()).toEqual([...objects.keys()].sort());
  });

  it('parses one blob once per extension, and answers the same edges a direct parse would', () => {
    const memo: ParseMemo = new Map();
    const read = importEdges(blobTree(objects, texts, memo, [js]), files, 'every', [js]);
    expect(read.edges.map(({ file, line, to }) => ({ file, line, to }))).toEqual([
      { file: 'src/one.ts', line: 1, to: 'src/a.ts' },
      { file: 'src/two.ts', line: 1, to: 'src/a.ts' },
      { file: 'src/view.svelte', line: 2, to: 'src/a.ts' },
    ]);
    expect(memo.size).toBe(2);
  });

  it('holds every blob parsed ahead, so the reading after it parses nothing and answers the same', async () => {
    const memo: ParseMemo = new Map();
    await parseAhead(
      memo,
      [js],
      [...objects].map(([path, object]) => ({ object, path, text: texts.get(object) as string })),
    );
    expect(memo.size).toBe(3);
    const read = importEdges(blobTree(objects, texts, memo, [js]), files, 'every', [js]);
    expect(memo.size).toBe(3);
    expect(read).toEqual(importEdges(blobTree(objects, texts, new Map(), [js]), files, 'every', [js]));
  });

  it('refuses to answer a listed path whose text was never read, rather than reading it as empty', () => {
    const tree = blobTree(new Map([['src/binary.ts', 'blob-binary']]), new Map(), new Map(), [js]);
    expect(() => importEdges(tree, ['src/binary.ts'], 'every', [js])).toThrow('src/binary.ts');
  });

  it('names every listed path read without its text in the missing set, and memoises no parse of one', () => {
    const memo: ParseMemo = new Map();
    const missing = new Set<string>();
    const listed = new Map([
      ['src/one.ts', 'blob-script'],
      ['src/a.ts', 'blob-a'],
      ['package.json', 'blob-manifest'],
    ]);
    const tree = blobTree(listed, new Map([['blob-script', script]]), memo, [js], missing);
    const read = importEdges(tree, ['src/one.ts', 'src/a.ts'], 'every', [js]);
    tree.read('package.json');
    expect(read.edges.map(({ to }) => to)).toEqual(['src/a.ts']);
    expect([...missing].sort()).toEqual(['package.json', 'src/a.ts']);
    expect(memo.size).toBe(1);
    expect(() => tree.read('src/unlisted.ts')).toThrow('src/unlisted.ts');
  });
});
