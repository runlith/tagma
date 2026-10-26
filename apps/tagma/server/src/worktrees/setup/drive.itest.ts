import { RequestKey } from '../../platform/contract/wire/ids.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Deferred, Effect, Fiber, FileSystem, Layer, Path } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { type DemoState, demoGraphLayer, tempRepoEffect, withDemo } from '../../composition/testing/graphFixture.js';
import { makeCoverageStore } from '../../workspace/store/coverage.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { coveredRepositoryReader, coveredWorkspace, environmentLedger } from '../../workspace/testing/doubles.js';
import { creationDriver, worktreeCreator, worktreeStore } from '../testing/doubles.js';
import { Git } from '@runlith/git/Git';
import { Settings } from '../../settings/contract/service/values.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';
import { makeBackendRegistry } from '../../workspace/environments/backends.js';
import { makeEnvironmentStore } from '../../workspace/store/environments.js';
import { makeEnvironmentUseStore } from '../../workspace/store/environmentUses.js';
import { makeEnvironmentUses } from '../../workspace/environments/uses.js';
import { makeHostEnvironment } from '../../executions/host/environmentBackend.js';
import { makeMachineWorld } from '../../executions/worlds/machine.js';
import { makeWorktreeSetups } from './drive.js';
import { SetupCommands } from '../contract/service/setup.js';
import type { SetupEnding, SetupLaunch } from '../../executions/contract/wire/setup.js';

const machineWorld = makeMachineWorld(() => null);

const EXECUTION: ExecutionRef = {
  installation: InstallationId.make('setup-test'),
  execution: ExecutionId.make('setup-execution'),
  incarnation: 0,
};

const ended = (exitCode: number, tail = ''): SetupEnding => ({
  _tag: 'Exited',
  execution: EXECUTION,
  exitCode,
  tail,
});

type Script = {
  readonly launches: SetupLaunch[];
  readonly watched: ExecutionRef[];
  exit: number;
  gate: Deferred.Deferred<void> | null;
  readonly launched?: Deferred.Deferred<void>;
};

const scripted = (script: Script) =>
  SetupCommands.of({
    run: (launch) =>
      Effect.andThen(
        Effect.sync(() => script.launches.push(launch)),
        Effect.matchEffect(launch.started(EXECUTION), {
          onFailure: (failure) => Effect.succeed({ _tag: 'Unread' as const, execution: EXECUTION, said: failure.message }),
          onSuccess: Effect.fnUntraced(function* () {
            if (script.launched !== undefined) yield* Deferred.succeed(script.launched, undefined);
            if (script.gate !== null) yield* Deferred.await(script.gate);
            return ended(script.exit, script.exit === 0 ? '' : 'the install broke');
          }),
        }),
      ),
    watch: (_projectId, execution) =>
      Effect.sync(() => {
        script.watched.push(execution);
        return ended(script.exit);
      }),
  });

const composed = Effect.fnUntraced(function* (demo: DemoState, script: Script) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const liveGit = yield* Git;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'worktree-setup-' });
  const access = yield* environmentLedger(
    makeBackendRegistry({ backends: [yield* makeHostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld })] }),
    makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }),
    units,
  );
  const state = yield* access.inspect('host');
  if (state.binding === null) return yield* Effect.die(`the host answered for no identity: ${state.reason}`);
  const records = yield* worktreeStore(makeCoverageStore({ db }));
  const { roots, repositories, coverage } = yield* coveredWorkspace({
    namespaceId: state.binding.namespaceId,
    projects: demo.graph.projects,
    git: liveGit,
    reservations: records,
  });
  const stores = yield* coveredRepositoryReader(coverage, roots, repositories, paths, files);
  const folder = yield* files.makeTempDirectoryScoped({ prefix: 'worktree-setup-trees-' });
  const worktrees = yield* worktreeCreator({ intents: records, records, repositories, roots, git: liveGit, files, paths, units });
  const acts = yield* creationDriver({ worktrees, environments: access, stores, roots, folder: () => Effect.succeed(folder) });
  const setups = yield* makeWorktreeSetups().pipe(
    Effect.provideService(MachineUnits, units),
    Effect.provideService(WorktreeRecords, records),
    Effect.provideService(Settings, demo.graph.settings),
    Effect.provideService(Git, liveGit),
    Effect.provideService(SetupCommands, scripted(script)),
  );
  worktrees.onRecorded((_projectId, rootId) => {
    setups.start(rootId);
  });
  const made = Effect.fnUntraced(function* (projectId: number, name: string) {
    yield* coverage.cover(projectId);
    const listing = yield* stores.at(projectId, (yield* demo.graph.projects.byId(projectId)).rootPath);
    const store = listing.repositories[0];
    if (store === undefined) return yield* Effect.die('the project covers no store');
    const operationId = RequestKey.make(`setup-${name}`);
    yield* acts.prepare(
      { projectId },
      {
        operationId,
        repository: store.binding,
        mode: { kind: 'new-branch', branch: `setup/${name}`, start: 'HEAD' },
      },
    );
    const created = yield* acts.create({ projectId }, operationId);
    if (created.rootId === null) return yield* Effect.die(`the creation ended ${created.status}`);
    return RootId.make(created.rootId);
  });
  const recordOf = (rootId: RootId) => units.read((unit) => records.byRoot(rootId, unit));
  return { setups, made, recordOf, records, units };
});

const project = Effect.fnUntraced(function* (demo: DemoState, name: string) {
  const files = yield* FileSystem.FileSystem;
  const checkout = yield* tempRepoEffect(demo.fixture, `${name}-`);
  yield* files.writeFileString(join(checkout, '.gitignore'), '.env*\n');
  yield* files.writeFileString(join(checkout, '.env.local'), 'SECRET=main\n');
  const projectId = (yield* demo.graph.projectLifecycle.create({ name, rootPath: checkout })).id;
  return { checkout, projectId };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'worktree setup',
  (it) => {
    it.effect('ignored files precede setup, survive a failed command, and settle done when copying is all the setup asks', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const script: Script = {
            launches: [],
            watched: [],
            exit: 0,
            gate: yield* Deferred.make<void>(),
            launched: yield* Deferred.make<void>(),
          };
          const { setups, made, recordOf } = yield* composed(demo, script);
          const { projectId } = yield* project(demo, 'setup-ready');
          yield* demo.graph.settings.write({ scope: 'project', projectId, key: 'worktrees.setupRun', value: 'pnpm install' });

          const rootId = yield* made(projectId, 'ready');
          const waiting = yield* Effect.forkChild(setups.ready(rootId));
          yield* Deferred.await(script.launched!);
          expect(waiting.pollUnsafe()).toBeUndefined();
          const running = yield* recordOf(rootId);
          expect(running?.setup).toBe('running');
          expect(running?.setupDetail?.execution).toEqual(EXECUTION);

          const tree = running?.path ?? '';
          const files = yield* FileSystem.FileSystem;
          expect(yield* files.readFileString(join(tree, '.env.local'))).toBe('SECRET=main\n');
          expect(yield* files.exists(join(tree, '.gitignore'))).toBe(false);
          expect(script.launches.map((launch) => ({ cwd: launch.cwd, command: launch.command }))).toEqual([
            { cwd: tree, command: 'pnpm install' },
          ]);

          yield* Deferred.succeed(script.gate!, undefined);
          const settled = yield* Fiber.join(waiting);
          expect(settled?.setup).toBe('done');

          script.exit = 1;
          script.gate = null;
          const failed = yield* setups.ready(yield* made(projectId, 'failed'));
          expect(failed?.setup).toBe('failed');
          expect(failed?.setupDetail).toMatchObject({ step: 'run', execution: EXECUTION });
          expect(yield* files.exists(join(failed?.path ?? '', '.env.local'))).toBe(true);

          yield* demo.graph.settings.write({ scope: 'project', projectId, key: 'worktrees.setupRun', value: '' });
          expect((yield* setups.ready(yield* made(projectId, 'copied')))?.setup).toBe('done');
        }),
      ),
    );
  },
);
