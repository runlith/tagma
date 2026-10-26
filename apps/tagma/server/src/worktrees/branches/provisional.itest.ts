import { makeCoverageStore } from '../../workspace/store/coverage.js';
import { shippedSteps } from '../../graph/steps/sequence.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Path } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ShadowGit } from '../../graph/tree/shadow.js';
import { syncTopology } from '../../graph/tree/topology.js';
import { type DemoState, demoGraphLayer, tempRepoEffect, withDemo } from '../../composition/testing/graphFixture.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { environmentLedger, fileRootStore, repositoryRegistry, repositoryStore, rootRegistry } from '../../workspace/testing/doubles.js';
import { makeBackendRegistry } from '../../workspace/environments/backends.js';
import { makeEnvironmentStore } from '../../workspace/store/environments.js';
import { makeEnvironmentUseStore } from '../../workspace/store/environmentUses.js';
import { makeEnvironmentUses } from '../../workspace/environments/uses.js';
import { makeHostEnvironment } from '../../executions/host/environmentBackend.js';
import { makeMachineWorld } from '../../executions/worlds/machine.js';
import type { BranchTwins } from '../../graph/contract/service/branchTwins.js';
import { makeProvisionalBranches } from './provisional.js';
import { BranchRefs } from '../contract/service/refs.js';
import { makeGitBranchRefs } from '../git/refs.js';
import { idleThreads, openGate, worktreeCreator, worktreeStore } from '../testing/doubles.js';
import { Git } from '@runlith/git/Git';
import { BranchTwinning } from '../contract/service/branches.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { FinishingGate } from '../contract/service/retirement.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';

const machineWorld = makeMachineWorld(() => null);

const sh = (cwd: string, args: readonly string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd }), (run) =>
      run.status === 0 ? Effect.succeed(run.stdout.trim()) : Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr}`)),
    ),
  );

const composed = Effect.fnUntraced(function* (demo: DemoState, twins: BranchTwins) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = yield* Git;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'provisional-branches-' });
  const access = yield* environmentLedger(
    makeBackendRegistry({ backends: [yield* makeHostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld })] }),
    makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }),
    units,
  );
  const state = yield* access.inspect('host');
  if (state.binding === null) return yield* Effect.die(`the host answered for no identity: ${state.reason}`);
  const acquired = yield* access.acquireActive({
    binding: state.binding,
    consumer: { kind: 'test', id: 'provisional' },
    requires: ['files', 'exec'],
  });
  const records = yield* worktreeStore(makeCoverageStore({ db }));
  const roots = yield* rootRegistry(yield* fileRootStore(db, units), files, paths, state.binding.namespaceId, records);
  const repositories = yield* repositoryRegistry(yield* repositoryStore(db, units), git, files, paths, state.binding.namespaceId);
  const worktrees = yield* worktreeCreator({ intents: records, records, repositories, roots, git, files, paths, units });
  const project = yield* tempRepoEffect(demo.fixture, 'provisional-');
  const projectId = (yield* demo.graph.projectLifecycle.create({ name: paths.basename(project), rootPath: project })).id;
  const store = yield* repositories.register({ path: project, projectId });
  const trunk = yield* sh(project, ['symbolic-ref', '--short', 'HEAD']);
  const standing = new Map<string, string | null>();
  const make = Effect.fnUntraced(function* (branch: string, threadId: string | null) {
    const operationId = RequestKey.make(branch.replaceAll('/', '-'));
    yield* worktrees.prepare({
      intent: {
        operationId,
        projectId,
        repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
        destination: paths.join(paths.dirname(project), `${paths.basename(project)}-${operationId}`),
        mode: { kind: 'new-branch', branch, start: trunk },
      },
      acquired,
    });
    const made = yield* worktrees.execute({ operationId, projectId, acquired });
    if (made.rootId === null) return yield* Effect.die(`the creation ended ${made.status}`);
    const rootId = RootId.make(made.rootId);
    if (threadId !== null) {
      yield* units.write('ProvisionalBranches.make', (unit) => records.nameAfter(rootId, threadId, unit));
      standing.set(threadId, rootId);
    }
    return { rootId, path: made.destination };
  });
  const branches = yield* makeProvisionalBranches.pipe(
    Effect.provideService(BranchRefs, yield* makeGitBranchRefs()),
    Effect.provideService(WorktreeRecords, records),
    Effect.provideService(BranchTwinning, BranchTwinning.of({ twins })),
    Effect.provideService(WorktreeThreads, idleThreads({ standingRoot: (threadId) => Effect.succeed(standing.get(threadId) ?? null) })),
    Effect.provideService(FinishingGate, openGate),
  );
  const recorded = (rootId: RootId) => units.read((unit) => records.byRoot(rootId, unit));
  return { branches, make, project, recorded, standing };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'provisional branches',
  (it) => {
    it.effect(
      "a provisional branch takes its thread's title with prefix and suffix kept, and its graph twin is the same twin under the new name",
      () =>
        withDemo((demo) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const home = yield* files.makeTempDirectoryScoped({ prefix: 'provisional-shadow-' });
            const shadow = yield* ShadowGit.open(join(home, 'graph.git'), yield* Git, null);
            const twins: BranchTwins = (place, rename) => Effect.andThen(Effect.orDie(shadow.renameBranch(place.from, place.to)), rename);
            const { branches, make, project, recorded } = yield* composed(demo, twins);
            yield* Effect.orDie(syncTopology(shadow, project, join(home, 'trees', 'main'), shippedSteps));
            const tree = yield* make('tagma/thread-a1b2c3', 'thread-1');
            const twinTree = join(home, 'trees', 'tree');
            yield* Effect.orDie(syncTopology(shadow, tree.path, twinTree, shippedSteps));
            yield* files.writeFileString(
              join(twinTree, 'claim.md'),
              '---\nid: claim\nkind: doc\ntitle: claim\nord: 1\n---\nwritten before the rename',
            );
            yield* Effect.orDie(shadow.commitAct(twinTree, 'create claim'));

            const titled = yield* branches.titled('thread-1', 'Fix Login Redirect');

            expect(titled).toEqual({
              status: 'renamed',
              rootId: tree.rootId,
              from: 'tagma/thread-a1b2c3',
              to: 'tagma/fix-login-redirect-a1b2c3',
            });
            expect(yield* sh(tree.path, ['symbolic-ref', '--short', 'HEAD'])).toBe('tagma/fix-login-redirect-a1b2c3');
            expect((yield* recorded(tree.rootId))?.branch).toBe('tagma/fix-login-redirect-a1b2c3');
            const synced = yield* Effect.orDie(syncTopology(shadow, tree.path, twinTree, shippedSteps));
            expect([synced.branch, synced.forkedFrom, synced.stranded]).toEqual(['tagma/fix-login-redirect-a1b2c3', null, []]);
            expect(yield* files.exists(join(twinTree, 'claim.md'))).toBe(true);
            expect(yield* branches.titled('thread-1', 'Another Title')).toBeNull();
          }),
        ),
    );
  },
);
