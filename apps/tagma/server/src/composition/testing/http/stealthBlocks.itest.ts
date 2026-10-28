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
      expect(JSON.stringify(found.body)).toContain('"stealth":true');
      const kept = yield* world.op('query_blocks', { project, stealth: true, sort: { by: 'created', order: 'asc' } });
      expect((kept.body as { blocks: readonly { title: string }[] }).blocks.map((row) => row.title)).toEqual(['Vendor terms', 'Clause']);
      expect(yield* suiteGit(root, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma')).toBe('');
    }),
  );

  it.effect('set_block_storage carries a whole subtree out of .tagma into the stealth tree and back', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('moving'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const roadmap = ((yield* world.op('create_block', { project, title: 'Roadmap' })).body as Written).block.name;
      expect((yield* world.op('create_block', { project, title: 'Quarter plan', parentId: roadmap })).status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const inTeam = () => Effect.map(suiteGit(root, 'ls-files', '--', '.tagma'), (listed) => listed.includes('roadmap'));
      expect(yield* inTeam()).toBe(true);

      expect((yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'stealth' })).status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      expect(yield* inTeam()).toBe(false);
      const unchanged = yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'stealth' });
      expect((unchanged.body as { code: string }).code).toBe('storage-unchanged');
      yield* world.runtime.pool.releaseProject(project);
      const tree = join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root));
      const hidden = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(hidden).toContain('/roadmap/quarter-plan.md');

      expect((yield* world.op('set_block_storage', { project, blockId: roadmap, storage: 'team' })).status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      expect(yield* inTeam()).toBe(true);
      expect(yield* suiteGit(root, 'ls-files', '--', '.tagma')).toContain('roadmap/quarter-plan.md');
    }),
  );

  it.effect('one apply_batch creates the first stealth block of a project and moves another block into it', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('batch'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const pricing = ((yield* world.op('create_block', { project, title: 'Pricing' })).body as Written).block.name;
      const batch = yield* world.op('apply_batch', {
        project,
        source: JSON.stringify({
          ops: [
            { op: 'create', $id: 'deals', title: 'Deals', storage: 'stealth' },
            { op: 'storage', id: pricing, storage: 'stealth' },
            { op: 'create', title: 'Changelog' },
          ],
        }),
      });
      expect(batch.status).toBe(200);
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      const tracked = yield* suiteGit(root, 'ls-files', '--', '.tagma');
      expect(tracked).toContain('changelog.md');
      expect(tracked).not.toContain('pricing');
      expect(tracked).not.toContain('deals');
      yield* world.runtime.pool.releaseProject(project);
      const tree = join(graphHome(world.dataHome, project), 'layers', stealthTreeName(root));
      const hidden = yield* suiteGit(tree, 'ls-tree', '-r', '--name-only', 'HEAD');
      expect(hidden).toContain('/deals.md');
      expect(hidden).toContain('/pricing.md');
    }),
  );
});
