import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Stream } from 'effect';
import { ServingGit } from '../../../executions/contract/service/git.js';
import { CheckoutWatch } from '../../../workspace/contract/service/watch.js';
import { CheckoutRows } from '../../../workspace/contract/service/checkouts.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { doorFixture, DoorFixture } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';
import { suiteGit, suiteGitRan } from '../suiteGit.js';
import { seedRepository } from './native.js';
import { ThreadJournal } from '../../../threads/contract/service/engine.js';
import { receiptsOver } from '../../../landing/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('merge conclusion', (it) => {
  it.effect('a watched worktree leaves its open-merge state after submit_work concludes it and can merge into main', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const main = yield* files.realPath(yield* world.directory('merge-source'));
      yield* seedRepository(main);
      yield* files.writeFileString(join(main, 'choice.txt'), 'base\n');
      yield* suiteGit(main, 'add', 'choice.txt');
      yield* suiteGit(main, 'commit', '-qm', 'base');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: main, storage: 'team' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      const op = (id: string, input: unknown) => world.op(id, input, `project=${project}`);
      expect((yield* op('write_setting', { key: 'graph.commit', value: 'manual' })).status).toBe(200);
      expect((yield* op('sync_graph', {})).status).toBe(200);
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const repositories = (yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer;
      const repository = repositories.repositories[0]!.binding;
      const side = join(yield* files.realPath(yield* world.directory('worktrees')), 'own-ui');
      expect(
        (yield* op('prepare_worktree', {
          operationId: 'own-ui',
          repository,
          destination: side,
          mode: { kind: 'new-branch', branch: 'own-ui', start: 'HEAD' },
        })).status,
      ).toBe(200);
      const created = yield* op('create_worktree', { operationId: 'own-ui' });
      expect(created.status).toBe(200);
      const rootId = RootId.make((created.body as { operation: { rootId: string } }).operation.rootId);
      const born = yield* op('create_thread', { approvalMode: 'bypass' });
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      expect((yield* op('move_thread', { threadId: thread.id, worktree: rootId })).status).toBe(200);
      yield* files.writeFileString(join(side, 'choice.txt'), 'side\n');
      yield* suiteGit(side, 'add', 'choice.txt');
      yield* suiteGit(side, 'commit', '-qm', 'side');
      const head = yield* suiteGit(side, 'rev-parse', 'HEAD');
      yield* files.writeFileString(join(main, 'choice.txt'), 'main\n');
      yield* suiteGit(main, 'add', 'choice.txt');
      yield* suiteGit(main, 'commit', '-qm', 'main');
      const tip = yield* suiteGit(main, 'rev-parse', 'HEAD');
      expect((yield* suiteGitRan(side, 'merge', '--no-edit', 'main')).exitCode).toBe(1);
      yield* files.writeFileString(join(side, 'choice.txt'), 'resolved\n');
      yield* suiteGit(side, 'add', 'choice.txt');
      const rows = Context.get(world.runtime.workspace, CheckoutRows);
      const changes = yield* rows.follow(rootId).pipe(Effect.provide(world.runtime.owners));
      expect((yield* rows.refresh(rootId)).operation).toBe('merge');
      const following = yield* Effect.acquireRelease(
        Context.get(world.runtime.workspace, CheckoutWatch).follow(rootId).pipe(Effect.provide(world.runtime.owners)),
        (watch) => Effect.sync(() => watch.release()),
      );
      const moved = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        Stream.runForEach(following.shifts, (shift) =>
          shift.movements.includes('head') || shift.movements.includes('refs') ? Deferred.succeed(moved, undefined) : Effect.void,
        ),
      );
      const quitting = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const serving = ServingGit.of({
        run: (_act, git) =>
          Effect.succeed({
            ...git,
            run: (args, options) =>
              args.includes('merge') && args.includes('--quit')
                ? Effect.andThen(Deferred.succeed(quitting, undefined), Effect.andThen(Deferred.await(proceed), git.run(args, options)))
                : git.run(args, options),
          }),
      });
      const doors = makeThreadDoors(
        {
          ...world,
          runtime: {
            ...world.runtime,
            owners: Context.add(world.runtime.owners, ServingGit, serving),
          },
        },
        project,
        ['submit_work', 'merge_worktree'],
      );
      const placed = yield* doors.doorsFor(thread.id, thread.ownerId);
      const submitted = yield* Effect.forkScoped(
        doors.atNative('submit_work', { subject: 'resolve main merge', paths: ['choice.txt'] }, placed),
      );
      yield* Deferred.await(quitting);
      const gitDir = yield* suiteGit(side, 'rev-parse', '--absolute-git-dir');
      yield* Deferred.await(moved);
      const during = yield* rows.refresh(rootId);
      expect(during.operation).toBe('merge');
      expect(during.unwatched).toBe(false);
      yield* Deferred.succeed(proceed, undefined);
      expect(yield* Fiber.join(submitted)).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed' } } });
      expect(yield* suiteGit(side, 'rev-list', '--parents', '-1', 'HEAD')).toBe(`${during.head} ${head} ${tip}`);
      expect(yield* files.exists(join(gitDir, 'MERGE_HEAD'))).toBe(false);
      const closed = yield* Stream.runHead(changes.pipe(Stream.filter((row) => row.head === during.head && row.operation === 'none')));
      expect(closed._tag).toBe('Some');
      const journal = Context.get(world.runtime.owners, ThreadJournal);
      const position = yield* journal.headPosition(thread.id);
      const merged = yield* doors.atNative('merge_worktree', { rootId, whenBaseFree: true }, placed);
      expect(merged).toMatchObject({ class: 'answer', value: { status: 'merged' } });
      const commit = yield* suiteGit(main, 'rev-parse', 'HEAD');
      const store = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      expect(yield* receiptsOver(store.db, units).read(rootId, commit)).toMatchObject({ rootId, commit, addressees: [thread.id] });
      expect(yield* journal.eventsAfter(thread.id, position, 10)).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ entry: expect.objectContaining({ event: 'merged', rootId, commit }) }),
        }),
      );
      expect(yield* files.readFileString(join(main, 'choice.txt'))).toBe('resolved\n');
    }),
  );
});
