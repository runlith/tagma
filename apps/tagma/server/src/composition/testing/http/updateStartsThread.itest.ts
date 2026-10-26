import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { suiteGit } from '../suiteGit.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: '60 seconds',
})('worktree update', (it) => {
  it.effect('an update of a worktree no thread stands in starts one there, and that thread takes the next update', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* world.directory('updated');
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, 'seed.txt'), 'seed\n');
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'seed');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      const project = (added.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, project);
      const op = (id: string, input: unknown) => world.op(id, input, `project=${project}`);
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const repository = ((yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer).repositories[0]!.binding;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'side');
      expect(
        (yield* op('prepare_worktree', {
          operationId: 'side',
          repository,
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'HEAD' },
        })).status,
      ).toBe(200);
      const rootId = ((yield* op('create_worktree', { operationId: 'side' })).body as { operation: { rootId: string } }).operation.rootId;

      const first = yield* op('update_worktree', { rootId });
      expect(first).toMatchObject({ status: 200, body: { status: 'handed', rootId, base: 'main' } });
      const second = yield* op('update_worktree', { rootId });
      expect((second.body as { threadId: string }).threadId).toBe((first.body as { threadId: string }).threadId);
    }),
  );
});
