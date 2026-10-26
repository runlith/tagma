import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  timeout: '60 seconds',
  testTimeout: '60 seconds',
})('graph sync', (it) => {
  it.effect('sync_graph creates the root commit of an unborn team repository and settles its index', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('unborn'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, 'source.ts'), 'export const value = 1;\n');
      const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      expect(born.status).toBe(200);
      const project = (born.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const synced = yield* world.op('sync_graph', { project });
      expect(synced.status).toBe(200);
      const commit = (synced.body as { sync: { commit: string } }).sync.commit;
      expect(yield* suiteGit(root, 'rev-list', '--parents', 'HEAD')).toBe(commit);
      const paths = (yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD')).split('\n');
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((path) => path.startsWith(`${CHECKOUT_DIRECTORY}/`))).toBe(true);
      expect(yield* suiteGit(root, 'status', '--porcelain')).toBe('?? source.ts');
      yield* suiteGit(root, 'add', 'source.ts');
      expect(yield* world.op('create_block', { project, title: 'Next graph commit' })).toMatchObject({ status: 200 });
      expect((yield* world.op('sync_graph', { project })).status).toBe(200);
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD^')).toBe(commit);
      expect(yield* suiteGit(root, 'status', '--porcelain')).toBe('A  source.ts');
    }),
  );
});
