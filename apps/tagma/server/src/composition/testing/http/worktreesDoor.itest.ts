import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import type { WorktreeIntent } from '../../../worktrees/contract/wire/creation.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { installedFixture } from '../plugin-host/installed.js';

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('worktrees HTTP door', (it) => {
  it.effect('a listed repository prepares one checkout and replays its creation without moving the project', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('worktrees'));
      const projectId = yield* world.stealthProject(root);
      yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
      yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
      const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
      const listing = yield* op('read_repositories', {});
      expect(listing.status).toBe(200);
      const repositories = (listing.body as CoveredRepositoriesAnswer).repositories;
      expect(repositories).toHaveLength(1);
      const repository = repositories[0]!;
      expect(repository.checkouts).toEqual([root]);
      const destination = join(yield* files.realPath(yield* world.directory('copies')), 'side');
      expect(
        yield* op('prepare_worktree', {
          operationId: 'driven',
          repository: repository.binding,
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'HEAD' },
        }),
      ).toMatchObject({ status: 200, body: { operation: { status: 'pending', reserved: false } } });
      const made = yield* op('create_worktree', { operationId: 'driven' });
      expect(made).toMatchObject({ status: 200, body: { operation: { status: 'ready' } } });
      const operation = (made.body as { operation: WorktreeIntent }).operation;
      expect(operation.rootId).not.toBeNull();
      expect(yield* files.exists(destination)).toBe(true);
      expect(yield* op('create_worktree', { operationId: 'driven' })).toEqual(made);
      expect(yield* op('read_worktree_operation', { operationId: 'driven' })).toEqual(made);
      expect(yield* op('read_project', { ref: String(projectId) })).toMatchObject({
        status: 200,
        body: { project: { rootPath: root } },
      });
    }),
  );

  it.effect('a plugin’s process deletes a worktree with uncommitted work, keeping that work on its branch', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('app-worktrees'));
      const projectId = yield* world.stealthProject(root);
      yield* suiteGit(root, 'commit', '-q', '--allow-empty', '-m', 'born');
      yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
      yield* installedFixture(world, projectId, { id: 'core-pin' });
      const op = (id: string, input: unknown, headers?: Readonly<Record<string, string>>) =>
        world.op(id, input, `project=${projectId}`, headers);
      const repository = ((yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer).repositories[0]!;
      const destination = join(yield* files.realPath(yield* world.directory('app-copies')), 'repair');
      yield* op('prepare_worktree', {
        operationId: 'repair',
        repository: repository.binding,
        destination,
        mode: { kind: 'new-branch', branch: 'repair', start: 'HEAD' },
      });
      const made = (yield* op('create_worktree', { operationId: 'repair' })).body as { operation: WorktreeIntent };
      yield* files.writeFileString(join(destination, 'left.txt'), 'unfinished\n');
      yield* files.writeFileString(join(destination, '.watch-cookie-4242-7'), '');

      expect(yield* op('delete_worktree', { rootId: made.operation.rootId }, { 'x-tagma-caller': 'plugin:core-pin' })).toMatchObject({
        status: 200,
        body: { status: 'branch-kept', committed: { paths: ['left.txt'] } },
      });
      expect(yield* files.exists(destination)).toBe(false);
    }),
  );
});
