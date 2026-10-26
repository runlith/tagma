import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import type { BlockFrontmatter } from './blockFile.js';
import { type TreeBlock, readBlockTree, writeBlockTree } from './layout.js';

const identity = (tail: string) => `01a03991-45fa-70d8-ac24-${tail.padStart(12, '0')}`;
const front = (tail: string, title: string, ord: number, extra?: Partial<BlockFrontmatter>): BlockFrontmatter => ({
  id: identity(tail),
  tags: ['idea'],
  title,
  ord,
  ...extra,
});

layer(BunFileSystem.layer, { excludeTestServices: true })('block tree layout', (it) => {
  it.effect('nested blocks, the reserved index title and siblings with colliding spoken tails round-trip without foreign files', () =>
    Effect.gen(function* () {
      const blocks: TreeBlock[] = [
        { parentId: null, frontmatter: front('a1', 'The Server', 1), body: 'root body' },
        { parentId: identity('a1'), frontmatter: front('b1', 'One File', 1), body: 'child' },
        { parentId: identity('a1'), frontmatter: front('b2', 'The Schema', 2, { tags: ['spec'], fields: { status: 'open' } }), body: '' },
        { parentId: identity('b1'), frontmatter: front('c1', 'The Unit of Work', 1), body: 'leaf' },
        { parentId: null, frontmatter: front('a2', 'Index', 2), body: 'the index leaf' },
        { parentId: null, frontmatter: front('111100c0ffee', 'Twin', 3), body: 'one' },
        { parentId: null, frontmatter: front('222200c0ffee', 'Twin', 4), body: 'two' },
        { parentId: null, frontmatter: front('333300c0ffee', 'Twin', 5), body: 'three' },
      ];
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'block-tree-' });
      yield* writeBlockTree(root, blocks);
      yield* fs.writeFileString(join(root, '.hidden.md'), 'not a block');
      yield* fs.writeFileString(join(root, 'notes.txt'), 'not a block');
      yield* fs.makeDirectory(join(root, 'payloads'));
      yield* fs.writeFileString(join(root, 'payloads', 'data.bin'), 'bytes');
      const back = yield* readBlockTree(root);
      expect(back).toHaveLength(blocks.length);
      expect(new Map(back.map(({ path: _path, ...row }) => [row.frontmatter.id, row]))).toEqual(
        new Map(blocks.map((row) => [row.frontmatter.id, row])),
      );
    }),
  );

  it.effect('an absent parent refuses before even a valid sibling is written', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'block-tree-' });
      const blocks: TreeBlock[] = [
        { parentId: null, frontmatter: front('a1', 'Valid', 1), body: '' },
        { parentId: identity('ffff'), frontmatter: front('b1', 'Orphan', 2), body: '' },
      ];
      expect((yield* Effect.flip(writeBlockTree(root, blocks))).reason).toBe('orphan');
      expect(yield* fs.readDirectory(root)).toEqual([]);
    }),
  );

  it.effect('a broken file refuses naming its path', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'block-tree-' });
      const path = join(root, 'broken.md');
      yield* fs.writeFileString(path, 'no fence here');
      const error = yield* Effect.flip(readBlockTree(root));
      expect(error.reason).toBe('file');
      expect(error.path).toBe(path);
    }),
  );

  it.effect('a directory holding block files without an index refuses instead of orphaning them', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'block-tree-' });
      yield* writeBlockTree(root, [
        { parentId: null, frontmatter: front('a1', 'Parent', 1), body: '' },
        { parentId: identity('a1'), frontmatter: front('b1', 'Child', 1), body: '' },
      ]);
      yield* fs.remove(join(root, 'parent', 'index.md'));
      const error = yield* Effect.flip(readBlockTree(root));
      expect(error.reason).toBe('orphan');
      expect(error.path).toBe(join(root, 'parent'));
    }),
  );
});
