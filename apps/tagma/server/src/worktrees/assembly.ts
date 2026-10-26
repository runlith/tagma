import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { gitHubCli } from '@runlith/github/GitHubCli';
import { actingGit } from '../platform/git/ownGit.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import type { RootId } from '../workspace/contract/wire/ids.js';
import type { ProjectRoot, ProjectRootFailure } from '../workspace/contract/wire/coverage.js';
import { Coverage } from '../workspace/contract/service/roots.js';
import { CheckoutRows } from '../workspace/contract/service/checkouts.js';
import { Worktrees, type WorktreeFolder } from './contract/service/creation.js';
import { WorktreeRows } from './contract/service/listing.js';
import { WorktreeRenames } from './contract/service/renames.js';
import { WorktreeCleanup } from './contract/service/cleanup.js';
import { PlaceSpace } from './contract/service/space.js';
import type { MergeChecks } from './contract/service/mergeChecks.js';
import { WorktreeHome } from './contract/service/home.js';
import { PendingMergeReads } from './contract/service/pending.js';
import { FinishingGate, WorktreeRetirement } from './contract/service/retirement.js';
import type { FinishingGuards } from './contract/service/finishingGate.js';
import type { ActProgress } from './contract/service/progress.js';
import type { NewBranches } from './contract/service/branches.js';
import { makeActProgress } from './progress.js';
import { makeMergeChecks } from './listing/mergeChecks.js';
import { makeFinishingGates } from './retirement/gates.js';
import { makeFinishingGuards } from './retirement/guards.js';
import { WorktreeUnavailable } from './contract/wire/failures.js';
import { worktreeFolder as worktreeFolderSetting } from './contract/wire/settings.js';
import { makeProvisionalBranches, type ProvisionalBranches } from './branches/provisional.js';
import { BranchRefs } from './contract/service/refs.js';
import { makeGitBranchRefs } from './git/refs.js';
import { makeBranchRenames } from './branches/rename.js';
import { newBranches } from './branches/new.js';
import { makeWorktreeRowReader } from './listing/rowReader.js';
import { makeWorktreeDeletion } from './retirement/delete.js';
import { makeBranchDeletion } from './retirement/branch.js';
import { makeUnbornWorktrees, type UnbornWorktrees } from './retirement/unborn.js';
import { makeCleanupCandidates } from './retirement/cleanup.js';
import { makeWorktreeSetups, type WorktreeSetups } from './setup/drive.js';
import { makeSpaceScans } from './space/scans.js';
import { worktreesLayer } from './layer.js';

export type WorktreeAssembly = {
  readonly creation: Worktrees['Service'];
  readonly announce: (projectId: number) => void;
  readonly covered: (projectId: number) => Effect.Effect<readonly ProjectRoot[], ProjectRootFailure>;
  readonly progress: ActProgress;
  readonly checks: MergeChecks;
  readonly gates: FinishingGate['Service'];
  readonly guards: FinishingGuards;
  readonly retirement: WorktreeRetirement['Service'];
  readonly branches: ProvisionalBranches;
  readonly newBranches: NewBranches['Service'];
  readonly setups: WorktreeSetups;
  readonly onSetupSettled: (listener: (rootId: RootId) => Effect.Effect<void>) => () => void;
  readonly unborn: UnbornWorktrees;
  readonly owners: Context.Context<
    Worktrees | WorktreeRows | WorktreeRetirement | FinishingGate | WorktreeRenames | WorktreeCleanup | PlaceSpace
  >;
};

export const assembleWorktrees = Effect.gen(function* () {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const coverage = yield* Coverage;
  const checkouts = yield* CheckoutRows;
  const settings = yield* Settings;
  const projects = yield* Projects;
  const { path: home } = yield* WorktreeHome;
  const { opened: afterPort } = yield* Maintenance;
  const { ofProject: pending, onMoved: pendingMoved } = yield* PendingMergeReads;
  const moved = new Set<(projectId: number) => void>();
  const announce = (projectId: number): void => {
    for (const listener of moved) listener(projectId);
  };
  const progress = yield* makeActProgress;
  const checks = yield* makeMergeChecks;
  const gates = makeFinishingGates();
  const coveredRoots = (projectId: number) =>
    coverage.covered(projectId).pipe(
      Effect.catchTag('ProjectRootsUnavailable', (refusal) =>
        refusal.reason === 'unestablished' || refusal.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(refusal),
      ),
      Effect.map((covering) => covering.roots),
    );
  const guards = yield* makeFinishingGuards({ covered: coveredRoots });
  const branches = yield* makeProvisionalBranches.pipe(
    Effect.provideService(FinishingGate, gates),
    Effect.provideService(BranchRefs, yield* makeGitBranchRefs()),
  );
  const folder: WorktreeFolder = Effect.fn('Worktrees.folder')(
    function* (projectId: number) {
      const set = yield* settings.read(worktreeFolderSetting, projectId);
      const project = yield* projects.byId(projectId);
      const place = join(set.value === '' ? home : set.value, project.name.replaceAll('/', '-'));
      yield* files.makeDirectory(place, { recursive: true });
      return place;
    },
    Effect.mapError(
      (failure) =>
        new WorktreeUnavailable({
          reason: 'filesystem',
          message: `This project's worktree folder could not be made: ${failure instanceof Error ? failure.message : String(failure)}`,
        }),
    ),
  );
  const creation = Context.get(yield* Layer.build(worktreesLayer(folder)), Worktrees);
  const setupListeners = new Set<(rootId: RootId) => Effect.Effect<void>>();
  const onSetupSettled = (listener: (rootId: RootId) => Effect.Effect<void>): (() => void) => {
    setupListeners.add(listener);
    return () => {
      setupListeners.delete(listener);
    };
  };
  const setups = yield* makeWorktreeSetups({
    settled: (rootId) => Effect.forEach([...setupListeners], (listener) => listener(rootId), { discard: true }),
  });
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      creation.onRecorded((projectId, rootId) => {
        coverage.recorded(projectId);
        setups.start(rootId);
      }),
    ),
    (release) => Effect.sync(release),
  );
  yield* Effect.forkScoped(
    afterPort.pipe(
      Effect.andThen(setups.resume()),
      Effect.tapCause((cause) => Effect.logWarning('unsettled worktree setups could not be resumed', { cause })),
    ),
  );
  const deletion = yield* makeWorktreeDeletion({
    guards,
    progress,
    branches: yield* makeBranchDeletion({ guards, checks, progress }).pipe(
      Effect.provideService(BranchRefs, yield* makeGitBranchRefs({ purpose: 'worktree-finishing' })),
    ),
    checks,
    announce,
  }).pipe(Effect.provideService(FinishingGate, gates));
  const retirement = WorktreeRetirement.of({
    delete: deletion.delete,
    place: guards.placeOf,
    terms: (projectId, rootId, asking) =>
      Effect.zipWith(guards.placeOf(projectId, rootId, false), guards.retiring(projectId, rootId, asking), (place, consents) => ({
        ...place,
        consents,
      })),
  });
  const renames = yield* makeBranchRenames({
    branches,
    gh: gitHubCli.run,
    mark: (rootId) => checkouts.mark(rootId),
    progress,
  }).pipe(Effect.provideService(FinishingGate, gates));
  const unborn = yield* makeUnbornWorktrees({ settled: (rootId) => setups.ready(rootId) }).pipe(
    Effect.provideService(WorktreeRetirement, retirement),
  );
  yield* Effect.forkScoped(afterPort.pipe(Effect.andThen(deletion.recover())));
  const listing = yield* makeWorktreeRowReader({
    recordMoved: (listener) => {
      moved.add(listener);
      const released = [
        creation.onRecorded(listener),
        () => {
          moved.delete(listener);
        },
        branches.onRenamed(listener),
        setups.onSettled(listener),
        coverage.onCovered(listener),
      ];
      return () => {
        for (const release of released) release();
      };
    },
    options: { checks, pending, pendingMoved, progress },
  });
  const ownedRetirement = Context.make(WorktreeRows, listing).pipe(Context.add(WorktreeRetirement, retirement));
  const cleanup = yield* makeCleanupCandidates({
    place: (projectId, rootId) => guards.placeOf(projectId, rootId, false),
    progress,
  }).pipe(Effect.provideContext(ownedRetirement));
  const space = yield* makeSpaceScans().pipe(Effect.provideService(WorktreeRows, listing));
  const owners = Context.make(Worktrees, creation).pipe(
    Context.add(WorktreeRows, listing),
    Context.add(WorktreeRetirement, retirement),
    Context.add(FinishingGate, gates),
    Context.add(WorktreeRenames, renames),
    Context.add(WorktreeCleanup, cleanup),
    Context.add(PlaceSpace, space),
  );
  return {
    creation,
    announce,
    covered: coveredRoots,
    progress,
    checks,
    gates,
    guards,
    retirement,
    branches,
    newBranches: newBranches(actingGit(git, 'thread-placement')),
    setups,
    onSetupSettled,
    unborn,
    owners,
  } satisfies WorktreeAssembly;
});
