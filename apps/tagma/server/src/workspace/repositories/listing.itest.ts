import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { ProjectLifecycle } from '../../graph/contract/service/serving.js';
import { GraphJournal } from '../../graph/contract/service/journal.js';
import { ProjectIdentification } from '../../projects/contract/service/registry.js';
import { DoorFixture, doorFixture, projectLeaving } from '../../composition/testing/doorFixture.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { Coverage } from '../contract/service/roots.js';
import { CoveredRepositories } from '../contract/service/repositories.js';
import { Worktrees } from '../../worktrees/contract/service/creation.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true, timeout: '30 seconds' })(
  'covered repositories',
  (it) => {
    it.effect('a creation approved while covered refuses once the coverage is gone', () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const files = yield* FileSystem.FileSystem;
        const stores = Context.get(world.runtime.owners, CoveredRepositories);
        const root = yield* files.realPath(yield* world.directory('covered'));
        const projectId = yield* world.stealthProject(root);
        yield* projectLeaving(world, projectId);
        const committed = yield* spawnedEffect(
          ['git', '-c', 'user.name=suite', '-c', 'user.email=suite@tagma', 'commit', '-q', '--allow-empty', '-m', 'born'],
          { cwd: root },
        );
        expect(committed.exitCode).toBe(0);
        const coverage = Context.get(world.runtime.workspace, Coverage);
        yield* coverage.cover(projectId);
        const binding = (yield* stores.list(projectId)).repositories[0]?.binding;
        if (binding === undefined) return yield* Effect.die('the covered repository was missing');
        const acts = Context.get(world.runtime.owners, Worktrees);
        const prepared = yield* acts.prepare(
          { projectId },
          {
            operationId: RequestKey.make('covered-then-not'),
            repository: binding,
            destination: join(yield* files.realPath(yield* world.directory('gone')), 'covered-then-not'),
            mode: { kind: 'new-branch', branch: 'covered-then-not', start: 'HEAD' },
          },
        );
        expect(prepared.operation.status).toBe('pending');
        const plain = yield* files.realPath(yield* world.directory('plain'));
        yield* coverage.adopt(projectId, plain);
        const moved = yield* Context.get(world.runtime.graph, ProjectLifecycle)
          .move(projectId, plain)
          .pipe(Effect.provideService(ProjectIdentification, Context.get(world.runtime.graph, ProjectIdentification)));
        expect(moved.rootPath).toBe(plain);
        const [movement] = yield* Context.get(world.runtime.graph, GraphJournal).events({ ops: ['project_set_root'], limit: 1 });
        expect(movement?.blockId).toBeNull();
        expect(JSON.parse(movement!.payload)).toEqual({ projectId, from: root, to: plain });
        yield* coverage.cover(projectId);
        expect(yield* stores.list(projectId)).toEqual({ repositories: [], withheld: [] });
        const refused = yield* Effect.flip(acts.create({ projectId }, RequestKey.make('covered-then-not')));
        expect(refused._tag).toBe('RepositoryMissing');
        expect(yield* files.exists(join(root, '.git'))).toBe(true);
      }),
    );
  },
);
