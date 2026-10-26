import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { type TreeBlock, writeBlockTree } from './layout.js';
import { scanTree } from './scan.js';
import { refused } from '../serving/refusal.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('tree scan', (it) => {
  it.effect('the worker returns whole blocks and their references, then refuses an unfinished merge naming its file', () =>
    Effect.gen(function* () {
      const blocks: TreeBlock[] = [
        {
          parentId: null,
          frontmatter: { id: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a', tags: ['zone'], title: 'The Server', ord: 1 },
          body: 'Storage law first — [[b41e77]]; the labeled one is [[c9d2f0|the unit of work]].',
        },
        {
          parentId: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a',
          frontmatter: { id: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7b', tags: ['idea'], title: 'One File', ord: 1 },
          body: 'no references here',
        },
      ];
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'tree-scan-' });
      yield* writeBlockTree(root, blocks);
      const scan = yield* scanTree(root);
      expect(scan.blocks).toHaveLength(blocks.length);
      expect(new Map(scan.blocks.map(({ path: _path, ...row }) => [row.frontmatter.id, row]))).toEqual(
        new Map(blocks.map((row) => [row.frontmatter.id, row])),
      );
      expect(scan.refs).toEqual([
        { fromId: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a', to: 'b41e77' },
        { fromId: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a', to: 'c9d2f0' },
      ]);
      const path = join(root, 'the-server', 'index.md');
      const [open, ...rest] = (yield* fs.readFileString(path)).split('\n');
      yield* fs.writeFileString(path, [open, '<<<<<<< HEAD', 'ord: 1', '=======', 'ord: 2', '>>>>>>> main', ...rest].join('\n'));
      const answer = yield* Effect.flip(refused(scanTree(root)));
      expect(answer.code).toBe('graph-unmerged');
      expect(answer.reason).toContain(path);
    }),
  );
});
