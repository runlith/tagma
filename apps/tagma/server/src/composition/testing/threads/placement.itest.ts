import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect, FileSystem, Layer, Path } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { type EffectDemo, demoGraphLayer, withDemo, gitEffect, tempRepoEffect } from '../graphFixture.js';
import { coverageStore } from '../../../workspace/testing/doubles.js';
import { coveredWorkspace } from '../../../workspace/testing/doubles.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { threadStore, targetSnapshotStore } from '../../../native-harness/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { assignmentStore } from '../../../workspace/testing/doubles.js';
import { assignmentLedger } from '../../../workspace/testing/doubles.js';

import { TargetPreparation } from '../../../threads/contract/service/preparation.js';
import { TargetSnapshots } from '../../../threads/contract/service/targetSnapshots.js';
import { ThreadLookup } from '../../../threads/contract/service/reads.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadList } from '../../../threads/contract/service/list.js';
import { Worlds } from '../../../executions/contract/service/worlds.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { environmentLedger } from '../../../workspace/testing/doubles.js';
import { backendRegistry } from '../../../workspace/testing/doubles.js';
import { environmentStore } from '../../../workspace/testing/doubles.js';
import { environmentUseStore } from '../../../workspace/testing/doubles.js';
import { environmentUses } from '../../../workspace/testing/doubles.js';
import { hostEnvironment } from '../../../executions/testing/doubles.js';
import { coveredRepositoryReader } from '../../../workspace/testing/doubles.js';
import { branchesOver, creationDriver, worktreeCreator, worktreeStore } from '../../../worktrees/testing/doubles.js';
import { threadParts } from '../threadParts.js';
import { targetContexts } from '../../../threads/testing/doubles.js';
import { listOf } from '../../../threads/testing/doubles.js';
import { threadMover, moverDoubles } from '../../../threads/testing/doubles.js';
import { placementCoordinator, placementDoubles } from '../../../threads/testing/doubles.js';
import { Assignments } from '../../../workspace/contract/service/assignments.js';
import { FileRoots, Coverage } from '../../../workspace/contract/service/roots.js';
import { CoveredRepositories } from '../../../workspace/contract/service/repositories.js';
import { WorktreeRecords } from '../../../worktrees/contract/service/worktrees.js';
import { WorktreeIntents } from '../../../worktrees/contract/service/intents.js';
import { Worktrees } from '../../../worktrees/contract/service/creation.js';
import { NewBranches } from '../../../worktrees/contract/service/branches.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { threadTargets } from '../../../threads/testing/doubles.js';
import { checkoutWorld } from '../../../executions/testing/doubles.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { leasedWorlds } from '../../../executions/testing/doubles.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { ENTRY_KINDS } from '../composed.js';

const machineWorld = makeMachineWorld(() => null);
const unexpected = (): never => {
  throw new Error('a root-placement test reached the running harness or a synchronous list subscription');
};

const composed = Effect.fn('testing.rootPlacement')(function* (demo: EffectDemo) {
  const git = yield* Git;
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'thread-placement-' });
  const access = yield* environmentLedger(
    backendRegistry([yield* hostEnvironment({ records: environmentStore(db), anchor, world: machineWorld })]),
    environmentUses(environmentUseStore(db)),
    units,
  );
  const state = yield* access.inspect('host');
  if (state.binding === null) return yield* Effect.die(new Error(`the host answered for no identity: ${state.reason}`));
  const records = yield* worktreeStore(coverageStore(db));
  const { roots, repositories, coverage } = yield* coveredWorkspace({
    namespaceId: state.binding.namespaceId,
    projects: demo.graph.projects,
    git,
    reservations: records,
  });
  const stores = yield* coveredRepositoryReader(coverage, roots, repositories, paths, files);
  const folder = yield* files.makeTempDirectoryScoped({ prefix: 'thread-placement-trees-' });
  const acts = yield* creationDriver({
    worktrees: yield* worktreeCreator({ intents: records, records, repositories, roots, git, files, paths, units }),
    environments: access,
    stores,
    roots,
    folder: () => Effect.succeed(folder),
  });
  const threadRecords = yield* makeThreadRecords;
  const kernel = yield* threadStore(threadRecords, ENTRY_KINDS);
  const threads = yield* threadParts({ db, units, threads: kernel, records: threadRecords });
  const assignments = yield* assignmentLedger(assignmentStore(db), roots, yield* lineageOver(store, units));
  const snapshots = yield* targetSnapshotStore();
  const contexts = yield* targetContexts().pipe(
    Effect.provideService(TargetSnapshots, snapshots),
    Effect.provideService(Assignments, assignments),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(Projects, demo.graph.projects),
  );
  const worlds = yield* leasedWorlds({
    checkout: (_thread, root) =>
      Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) })),
    hosts: [],
    place: () => Effect.succeed(null),
  });
  const placement = yield* placementCoordinator().pipe(
    Effect.provideService(MachineUnits, units),
    Effect.provideService(Assignments, assignments),
    Effect.provideService(FileRoots, roots),
    Effect.provideService(WorktreeRecords, records),
    Effect.provideService(WorktreeIntents, records),
    Effect.provideService(Coverage, coverage),
    Effect.provideService(CoveredRepositories, stores),
    Effect.provideService(Worktrees, acts),
    Effect.provideService(NewBranches, branchesOver(git)),
    Effect.provideService(Settings, demo.graph.settings),
    Effect.provide(placementDoubles),
  );
  const targets = yield* threadTargets({
    threads: {
      facetOf: (threadId) =>
        threads.list.find(threadId, 'operator').pipe(
          Effect.map((row) => (row === undefined ? undefined : { projectId: row.projectId, hostKind: row.hostKind })),
          Effect.orDie,
        ),
    },
    creations: { of: () => Effect.succeed(null) },
  }).pipe(
    Effect.provideService(Assignments, assignments),
    Effect.provideService(TargetPreparation, contexts),
    Effect.provideService(TargetSnapshots, snapshots),
  );
  const moves = yield* threadMover({ targets }).pipe(
    Effect.provide(moverDoubles(placement)),
    Effect.provideService(Projects, demo.graph.projects),
    Effect.provideService(ThreadLookup, threads.list),
    Effect.provideService(Worlds, worlds),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadHarness, {
          threads: {
            readCut: unexpected,
            handle: unexpected,
            create: unexpected,
            duplicate: unexpected,
            deleteByHost: unexpected,
            publish: unexpected,
            rewritten: unexpected,
            stepping: unexpected,
            unseen: unexpected,
            stepped: unexpected,
          },
          runs: {
            recover: unexpected,
            recoverNow: unexpected,
            ownership: unexpected,
            hosting: unexpected,
            questions: unexpected,
            onDriving: unexpected,
            driven: unexpected,
            redeliver: unexpected,
            parked: unexpected,
            transports: unexpected,
            reports: unexpected,
            ledger: unexpected,
            settlements: unexpected,
            guidance: unexpected,
            history: unexpected,
          },
          inputs: { deliver: unexpected },
          reads: {
            snapshot: unexpected,
            statuses: unexpected,
            endings: unexpected,
            newestEndings: unexpected,
            page: unexpected,
            attachFrom: unexpected,
            shape: unexpected,
            composition: unexpected,
            window: unexpected,
            cacheCurves: unexpected,
            pin: unexpected,
            query: unexpected,
            entryAt: unexpected,
            entryNamed: unexpected,
            steps: unexpected,
            requests: unexpected,
            subscribe: unexpected,
            openView: unexpected,
            subscribeStates: unexpected,
          },
          collaboration: { spawn: unexpected, collaborate: unexpected },
          workflows: { start: unexpected, advance: unexpected },
        }),
        Layer.mock(ThreadList, {
          announceThread: () => Effect.void,
          subscribeAttention: unexpected,
          observe: unexpected,
          subscribe: unexpected,
          announce: unexpected,
          announceFolders: unexpected,
          resync: unexpected,
          serveArchiving: unexpected,
          serveCuts: unexpected,
        }),
      ),
    ),
  );
  const root = (projectId: number) =>
    units.write('ThreadPlacement.root', (unit) =>
      Effect.gen(function* () {
        const row = yield* kernel.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: row.id, projectId }, unit);
        return row;
      }),
    );
  const child = (parent: { readonly id: string; readonly ownerId: string }) =>
    units.write('ThreadPlacement.child', (unit) =>
      Effect.gen(function* () {
        const row = yield* kernel.insertChild(
          parent.id,
          {
            ownerId: parent.ownerId,
            agentId: 'tagma',
            spawnedByRunId: null,
          },
          unit,
        );
        yield* threads.rows.inheritFacet(
          { threadId: row.id, fromThreadId: parent.id, agentId: 'tagma', carried: 'fresh', isRoot: false },
          unit,
        );
        yield* placement.born(unit, { threadId: row.id, parentThreadId: parent.id, lineage: 'child', guest: false });
        return row;
      }),
    );
  const opensIn = (thread: { readonly id: string }, projectId: number) =>
    Effect.map(
      contexts.of({ id: thread.id, projectId }, { kind: 'tools', runId: null, context: null }, (request) =>
        worlds.of({ thread: { id: thread.id, hostKind: null, hostId: null }, ...request }),
      ),
      (admitted) => admitted.world.root,
    );
  return { units, assignments, placement, moves, root, child, opensIn, paths, roots };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'thread root placement',
  (it) => {
    it.effect('a child is born where its parent stands: in main beside a main parent, in the worktree beside a parent there', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { assignments, units, placement, moves, root, child, opensIn } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'placed-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'placed', rootPath: checkout })).id;
          const parent = yield* root(projectId);

          const inMain = yield* child(parent);
          expect((yield* units.read((unit) => assignments.read(unit, ThreadId.make(inMain.id)))).selection.provenance).toBe('intrinsic');
          expect(yield* opensIn(inMain, projectId)).toBe(checkout);

          const tree = yield* placement.resolve({
            projectId,
            worktree: 'new',
            from: parent.id,
            operationId: 'spawn:call-1',
            name: 'reviewer',
            agent: true,
            asked: true,
            guest: false,
          });
          const again = yield* placement.resolve({
            projectId,
            worktree: 'new',
            from: parent.id,
            operationId: 'spawn:call-1',
            name: 'reviewer',
            agent: true,
            asked: true,
            guest: false,
          });
          expect(again.rootId).toBe(tree.rootId);

          const moved = yield* moves.move(projectId, { kind: 'operator' }, { threadId: parent.id, worktree: tree.rootId });
          expect(moved.status).toBe('selected');
          const treePath = yield* opensIn(parent, projectId);
          expect(treePath).not.toBe(checkout);

          const inTree = yield* child(parent);
          const placed = yield* units.read((unit) => assignments.read(unit, ThreadId.make(inTree.id)));
          expect(placed.selection).toMatchObject({ rootId: tree.rootId, provenance: 'inherited' });
          expect(yield* opensIn(inTree, projectId)).toBe(treePath);

          const back = yield* moves.move(projectId, { kind: 'operator' }, { threadId: parent.id, worktree: 'main' });
          expect(back.status).toBe('selected');
          expect(yield* opensIn(parent, projectId)).toBe(checkout);
        }).pipe(Effect.provide(demo.context)),
      ),
    );

    it.effect(
      'a new worktree given a name takes it as its branch under the prefix, and a name already taken refuses before git makes anything',
      () =>
        withDemo((demo) =>
          Effect.gen(function* () {
            const { placement, roots } = yield* composed(demo);
            const checkout = yield* tempRepoEffect(demo.fixture, 'named-');
            const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'named', rootPath: checkout })).id;
            const ask = (operationId: string) => ({
              projectId,
              worktree: 'new',
              from: null,
              operationId,
              name: 'thread',
              branch: '  Fix  login ',
              agent: false,
              asked: false,
              guest: false,
            });

            const made = yield* placement.resolve(ask('start:one'));
            const folder = (yield* roots.read(made.rootId)).path;
            const head = (yield* spawnedEffect(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd: folder })).stdout.toString().trim();
            expect(head).toBe('tagma/Fix-login');

            const taken = yield* Effect.flip(placement.resolve(ask('start:two')));
            expect(taken.code).toBe('worktree-name-taken');
          }).pipe(Effect.provide(demo.context)),
        ),
    );

    it.effect('an agent road that never asked the operator about a new worktree is refused where agent.worktrees is ask', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { placement, root } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'off-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'off', rootPath: checkout })).id;
          const parent = yield* root(projectId);
          yield* demo.graph.settings.write({ scope: 'project', projectId, key: 'agent.worktrees', value: 'ask' });

          const refused = yield* Effect.flip(
            placement.resolve({
              projectId,
              worktree: 'new',
              from: parent.id,
              operationId: 'spawn:call-2',
              name: 'worker',
              agent: true,
              asked: false,
              guest: false,
            }),
          );
          expect(refused).toBeInstanceOf(GateRefusal);
          expect(refused.code).toBe('worktrees-ask');

          const guest = yield* Effect.flip(
            placement.resolve({
              projectId,
              worktree: 'main',
              from: parent.id,
              operationId: 'spawn:call-3',
              name: 'worker',
              agent: true,
              asked: true,
              guest: true,
            }),
          );
          expect(guest.code).toBe('guest-mobility');

          const unasked = yield* Effect.flip(
            placement.resolve({
              projectId,
              worktree: 'new',
              from: null,
              operationId: 'start:agent-root',
              name: 'worker',
              agent: true,
              asked: false,
              guest: false,
            }),
          );
          expect(unasked.code).toBe('worktrees-ask');
        }).pipe(Effect.provide(demo.context)),
      ),
    );

    it.effect('a new worktree whose prefix stands as a branch is cut on the flattened name, and a retry answers the same tree', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { placement, roots } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'prefix-taken-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'prefix-taken', rootPath: checkout })).id;
          yield* gitEffect(checkout, ['branch', 'tagma']);
          const ask = (operationId: string) => ({
            projectId,
            worktree: 'new',
            from: null,
            operationId,
            name: 'reviewer',
            agent: false,
            asked: false,
            guest: false,
          });

          const made = yield* placement.resolve(ask('spawn:flat-1'));
          const folder = (yield* roots.read(made.rootId)).path;
          const head = (yield* spawnedEffect(['git', 'symbolic-ref', '--short', 'HEAD'], { cwd: folder })).stdout.toString().trim();
          expect(head).toMatch(/^tagma-reviewer-[0-9a-f]{6}$/);

          const again = yield* placement.resolve(ask('spawn:flat-1'));
          expect(again.rootId).toBe(made.rootId);
        }).pipe(Effect.provide(demo.context)),
      ),
    );

    it.effect('a name whose branch would stand under an existing branch refuses before git makes anything', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { placement } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'prefix-blocked-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'prefix-blocked', rootPath: checkout })).id;
          yield* gitEffect(checkout, ['branch', 'tagma']);
          const list = () => spawnedEffect(['git', 'branch', '--list', '--format=%(refname)'], { cwd: checkout });
          const before = (yield* list()).stdout.toString();

          const refused = yield* Effect.flip(
            placement.resolve({
              projectId,
              worktree: 'new',
              from: null,
              operationId: 'start:blocked',
              name: 'thread',
              branch: 'feature',
              agent: false,
              asked: false,
              guest: false,
            }),
          );
          expect(refused.code).toBe('worktree-name-taken');
          expect((yield* list()).stdout.toString()).toBe(before);
        }).pipe(Effect.provide(demo.context)),
      ),
    );

    it.effect('a name that would stand over an existing branch refuses as taken', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { placement } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'prefix-over-');
          const projectId = (yield* demo.graph.projectLifecycle.create({ name: 'prefix-over', rootPath: checkout })).id;
          yield* gitEffect(checkout, ['branch', 'tagma/feature']);
          yield* demo.graph.settings.write({ scope: 'project', projectId, key: 'worktrees.branchPrefix', value: '' });

          const refused = yield* Effect.flip(
            placement.resolve({
              projectId,
              worktree: 'new',
              from: null,
              operationId: 'start:over',
              name: 'thread',
              branch: 'tagma',
              agent: false,
              asked: false,
              guest: false,
            }),
          );
          expect(refused.code).toBe('worktree-name-taken');
        }).pipe(Effect.provide(demo.context)),
      ),
    );
  },
);
