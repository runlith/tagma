import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { graphHome, stealthTreeName } from '../../../graph/storage/layout.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

type Written = { readonly block: { readonly name: string } };

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('stealth blocks', (it) => {
  it.effect('a stealth subtree of a team project stays out of .tagma and the code history and commits to its own git', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('team'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const head = yield* suiteGit(root, 'rev-parse', 'HEAD');

      const terms = yield* world.op('create_block', { project, title: 'Vendor terms', body: 'kept inside', storage: 'stealth' });
      expect(terms.status).toBe(200);
      const parent = (terms.body as Written).block.name;
      expect((yield* world.op('create_block', { project, title: 'Clause', parentId: parent })).status).toBe(200);
      const refused = yield* world.op('create_block', { project, title: 'Public clause', parentId: parent, storage: 'team' });
      expect((refused.body as { code: string }).code).toBe('stealth-dependency');

      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(head);
      const tracked = yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(tracked).not.toContain('vendor-terms');

      yield* world.runtime.pool.releaseProject(project);
      const home = graphHome(world.dataHome, project);
      const tree = join(home, 'layers', stealthTreeName(root));
      const committed = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(committed.split('\n').some((path) => path.endsWith('/vendor-terms/index.md'))).toBe(true);
      expect(committed.split('\n').some((path) => path.endsWith('/vendor-terms/clause.md'))).toBe(true);

      const found = yield* world.op('search_blocks', { project, query: 'Clause' });
      expect(JSON.stringify(found.body)).toContain('Clause');
      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
    }),
  );
});
