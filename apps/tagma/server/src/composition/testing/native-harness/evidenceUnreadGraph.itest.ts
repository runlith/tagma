import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { targetSnapshotStore } from '../../../native-harness/testing/doubles.js';
import { asThreadShape, threadRun } from '../../../threads/testing/doubles.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'thread shape over unreadable graphs',
  (it) => {
    it.effect(
      'a thread that once stood in a checkout whose graph holds one identity twice still reads, with that checkout marked unread',
      () =>
        Effect.gen(function* () {
          const world = yield* DoorFixture;
          const files = yield* FileSystem.FileSystem;
          const root = yield* files.realPath(yield* world.directory('twinned'));
          yield* suiteGit(root, 'init', '-q', '-b', 'main');
          yield* files.writeFileString(join(root, 'seed.txt'), 'seed\n');
          yield* suiteGit(root, 'add', '-A');
          yield* suiteGit(root, 'commit', '-qm', 'seed');
          const born = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
          const project = (born.body as { project: { id: number } }).project.id;
          yield* projectLeaving(world, project);
          yield* Context.get(world.runtime.workspace, Coverage).cover(project);
          const at = (cwd: string) => `project=${project}&cwd=${encodeURIComponent(cwd)}`;
          expect((yield* world.op('sync_graph', {}, at(root))).status).toBe(200);
          const repository = ((yield* world.op('read_repositories', {}, at(root))).body as CoveredRepositoriesAnswer).repositories[0]!
            .binding;
          const destination = join(yield* files.realPath(yield* world.directory('twinned-copies')), 'side');
          const operationId = world.uniqueName();
          const mode = { kind: 'new-branch', branch: 'side', start: 'HEAD' };
          expect((yield* world.op('prepare_worktree', { operationId, repository, destination, mode }, at(root))).status).toBe(200);
          expect((yield* world.op('create_worktree', { operationId }, at(root))).status).toBe(200);

          const roots = yield* world.op('list_root_blocks', { project }, at(destination));
          const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
          expect((yield* world.op('create_block', { title: 'Twin', parentId }, at(destination))).status).toBe(200);
          const written = (yield* suiteGit(destination, 'status', '--porcelain', '--untracked-files=all', '--', '.tagma'))
            .split('\n')
            .map((line) => line.slice(3))
            .find((path) => path.endsWith('twin.md'));
          expect(written).toBeDefined();
          const original = join(destination, written!);
          yield* files.copyFile(original, join(dirname(original), 'twin-copy.md'));
          yield* world.runtime.pool.releaseProject(project);

          const created = yield* world.op('create_thread', {}, `project=${project}`);
          const threadId = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
          const db = Context.get(world.runtime.graph, MachineStore).db;
          const units = Context.get(world.runtime.graph, MachineUnits);
          const runId = `${threadId}-run`;
          yield* units.write('unreadGraph.run', (unit) =>
            unit.run(
              db.insert(threadRun()).values({
                id: runId,
                threadId,
                status: 'completed' as const,
                ownerId: OPERATOR_PRINCIPAL,
                provider: 'subscription',
                model: 'claude-opus-5-5',
                finishedAt: new Date('2026-09-06T10:00:00.000Z'),
              }),
            ),
          );
          const targets = yield* targetSnapshotStore().pipe(Effect.provide(world.runtime.graph));
          yield* units.write('unreadGraph.targets', (unit) =>
            Effect.forEach(
              [root, destination],
              (graphRoot, index) =>
                targets.record(
                  {
                    work: { projectId: project, threadId },
                    runId,
                    generation: WorkspaceGeneration.make(index),
                    sourceKey: 'root:unread-graph',
                    workingRoot: graphRoot,
                    place: null,
                    graph: { projectId: project, root: graphRoot },
                    admittedAt: '2026-09-06T10:00:00.000Z',
                  },
                  unit,
                ),
              { discard: true },
            ),
          );

          const shape = yield* world.op('read_thread', { threadId }, `project=${project}`);
          expect(shape.status).toBe(200);
          const read = (shape.body as { shape: ReturnType<typeof asThreadShape> }).shape;
          expect(read.thread.id).toBe(threadId);
          expect(read.runs.map((run) => run.id)).toEqual([runId]);
          expect(read.acts.name).toBeNull();
          expect(read.acts.unread).toHaveLength(1);
          expect(read.acts.unread[0]).toMatchObject({ projectId: project, root: destination, code: 'duplicate-identity' });
        }),
    );
  },
);
