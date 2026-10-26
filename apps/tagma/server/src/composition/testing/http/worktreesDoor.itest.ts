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
});
