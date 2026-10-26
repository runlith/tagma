import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { demoGraphLayer, withDemo } from './graphFixture.js';
import { composed, shEffect } from './finishingFixture.js';
import { makeMachineWorld } from '../../executions/testing/doubles.js';

layer(Layer.merge(demoGraphLayer({ repos: ['finishing'] }), BunFileSystem.layer), { excludeTestServices: true })(
  'worktree preservation',
  (it) =>
    it.effect('deleting preserves staged ignored files without collecting ignored siblings or descendants of a removed file', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { retirement, make, project, projectId } = yield* composed(
            demo,
            makeMachineWorld(() => null),
            { project: demo.project('finishing') },
          );
          const side = yield* make('ignored', true);
          yield* files.writeFileString(join(side.path, 'config'), 'tracked file\n');
          yield* files.writeFileString(join(side.path, 'rename-from'), 'rename survives\n');
          yield* shEffect(side.path, ['add', '--', 'config', 'rename-from']);
          yield* shEffect(side.path, ['commit', '-qm', 'configuration']);
          yield* files.rename(join(side.path, 'rename-from'), join(side.path, 'rename-to'));
          yield* files.remove(join(side.path, 'config'));
          yield* files.makeDirectory(join(side.path, 'config'));
          yield* files.writeFileString(join(side.path, 'config', 'secret'), 'ignored after file became directory\n');
          yield* files.writeFileString(join(project, '.git', 'info', 'exclude'), '.tagma/\nconfig/\n');
          yield* files.makeDirectory(join(side.path, '.tagma'));
          yield* files.writeFileString(join(side.path, '.tagma', 'env'), 'staged deliberately\n');
          yield* files.writeFileString(join(side.path, '.tagma', 'cache'), 'ignored without staging\n');
          yield* files.writeFileString(join(side.path, 'draft'), 'unfinished work\n');
          yield* shEffect(side.path, ['add', '-f', '--', '.tagma/env', 'rename-from', 'rename-to']);
          const deleted = yield* retirement.delete(projectId, side.rootId);
          expect(yield* files.exists(side.path)).toBe(false);
          if (deleted.branch.status !== 'kept' || deleted.branch.name === null || deleted.committed === null) {
            return yield* Effect.die('the detached work was not committed onto a branch');
          }
          const saved = deleted.branch.name;
          expect([...deleted.committed.paths].sort()).toEqual(['.tagma/env', 'config', 'draft', 'rename-from', 'rename-to']);
          expect(yield* shEffect(project, ['show', `${saved}:draft`])).toBe('unfinished work');
          expect(yield* shEffect(project, ['show', `${saved}:.tagma/env`])).toBe('staged deliberately');
          expect(yield* shEffect(project, ['show', `${saved}:rename-to`])).toBe('rename survives');
          expect(
            yield* shEffect(project, ['ls-tree', '-r', '--name-only', saved, '--', '.tagma', 'config', 'rename-from', 'rename-to']),
          ).toBe('.tagma/env\nrename-to');
        }),
      ),
    ),
);
