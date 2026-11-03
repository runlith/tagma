import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { LocationRevision } from '@runlith/files/resource';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { scanTree } from '../../../graph/testing/doubles.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { doorFixture, DoorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('projects door', (it) => {
  it.effect('a stealth project in a folder without git births its tree, root block and shadow, and creates no git there', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const root = yield* world.directory('stealth');
      const name = world.uniqueName();
      const created = yield* world.op('add_project', { name, rootPath: root, storage: 'stealth' });
      expect(created.status).toBe(200);
      const projectId = (created.body as { project: { id: number } }).project.id;
      const served = yield* world.runtime.pool.resolve({ projectId });
      expect(served.layout.mode).toBe('stealth');
      const scan = yield* scanTree(served.layout.treeRoot);
      expect(scan.blocks.map((entry) => entry.frontmatter.title)).toContain(name);
      expect(served.layout.treeRoot.startsWith(join(world.dataHome, 'graphs', String(projectId), 'trees'))).toBe(true);
      expect(existsSync(join(root, '.tagma'))).toBe(false);
      expect(existsSync(join(root, '.git'))).toBe(false);
      expect((yield* served.shadow!.log(served.layout.treeRoot)).length).toBeGreaterThan(0);
    }),
  );

  it.effect('a project folder renamed and re-pointed with set_project_root carries its git store to the new place', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const before = yield* files.realPath(yield* world.directory('renamed'));
      yield* suiteGit(before, 'init', '-q', '-b', 'main');
      yield* suiteGit(before, 'commit', '-q', '--allow-empty', '-m', 'born');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: before, storage: 'stealth' });
      const projectId = (added.body as { project: { id: number } }).project.id;
      const lens = `project=${projectId}`;
      expect((yield* world.op('list_worktrees', {}, lens)).status).toBe(200);
      const [standing] = ((yield* world.op('read_repositories', {}, lens)).body as CoveredRepositoriesAnswer).repositories;
      if (standing === undefined) return yield* Effect.die(new Error(`project ${projectId} covers no store`));
      const after = join(dirname(before), `${basename(before)}-after`);
      yield* files.rename(before, after);
      expect((yield* world.op('set_project_root', { ref: String(projectId), rootPath: after })).status).toBe(200);
      expect((yield* world.op('list_worktrees', {}, lens)).body).toMatchObject({ worktrees: { rows: [{ kind: 'main', folder: after }] } });
      const read = yield* world.op('read_repositories', {}, lens);
      expect((read.body as CoveredRepositoriesAnswer).repositories.map((one) => [one.binding, one.commonDirectory, one.checkouts])).toEqual(
        [
          [
            { repositoryId: standing.binding.repositoryId, locationRevision: LocationRevision.make(standing.binding.locationRevision + 1) },
            join(after, '.git'),
            [after],
          ],
        ],
      );
    }),
  );

  it.effect('a project whose repository no longer opens refuses its own paths and leaves every other project its places', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const born = Effect.fnUntraced(function* (label: string) {
        const root = yield* files.realPath(yield* world.directory(label));
        yield* suiteGit(root, 'init', '-q', '-b', 'main');
        yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
        const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
        return { root, projectId: (added.body as { project: { id: number } }).project.id };
      });
      const healthy = yield* born('healthy');
      const broken = yield* born('broken');
      yield* files.remove(join(broken.root, '.git'), { recursive: true });
      yield* files.writeFileString(join(broken.root, '.git'), `gitdir: ${join(broken.root, 'nowhere')}\n`);
      const owners = (projectId: number, root: string) => world.op('read_owners', { path: join(root, 'main.ts') }, `project=${projectId}`);
      expect((yield* owners(healthy.projectId, healthy.root)).status).toBe(200);
      expect((yield* owners(broken.projectId, broken.root)).body).toMatchObject({ code: 'files' });
      expect((yield* owners(healthy.projectId, healthy.root)).status).toBe(200);
      expect((yield* Effect.flip(Context.get(world.runtime.workspace, CheckoutPaths).rootsWithin(dirname(broken.root))))._tag).toBe(
        'PlaceUnread',
      );
    }),
  );
});
