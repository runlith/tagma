import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem } from 'effect';
import { Coverage } from '../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../workspace/contract/wire/repositories.js';
import { type DoorFixture, projectLeaving } from './doorFixture.js';
import { suiteGit } from './suiteGit.js';

export const teamTree = Effect.fnUntraced(
  function* (world: DoorFixture['Service'], branch: string) {
    const files = yield* FileSystem.FileSystem;
    const checkout = yield* files.realPath(yield* world.directory('team'));
    yield* suiteGit(checkout, 'init', '-q', '-b', 'main');
    yield* suiteGit(checkout, 'commit', '-q', '--allow-empty', '-m', 'born');
    const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: checkout, storage: 'team' });
    expect(added.status).toBe(200);
    const projectId = (added.body as { project: { id: number } }).project.id;
    yield* projectLeaving(world, projectId);
    yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
    const at = `project=${projectId}`;
    const listed = (yield* world.op('read_repositories', {}, at)).body as CoveredRepositoriesAnswer;
    const repository = listed.repositories[0]!.binding;
    const destination = join(yield* files.realPath(yield* world.directory('trees')), branch);
    expect(
      (yield* world.op(
        'prepare_worktree',
        { operationId: branch, repository, destination, mode: { kind: 'new-branch', branch, start: 'HEAD' } },
        at,
      )).status,
    ).toBe(200);
    const created = yield* world.op('create_worktree', { operationId: branch }, at);
    expect(created.body).toMatchObject({ status: 'ok' });
    return { projectId, checkout, destination, rootId: (created.body as { operation: { rootId: string } }).operation.rootId };
  },
  (effect) => Effect.provide(effect, BunFileSystem.layer),
);
