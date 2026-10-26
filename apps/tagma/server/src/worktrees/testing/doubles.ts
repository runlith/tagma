import { Context, Effect, FileSystem, Path } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { CoveredRepositories, Repositories } from '../../workspace/contract/service/repositories.js';
import { FileRoots, ProjectRootMembership, RootPublished } from '../../workspace/contract/service/roots.js';
import { Git } from '@runlith/git/Git';
import { newBranches } from '../branches/new.js';
import { makeCreationDriver } from '../creation/acts.js';
import { worktreeOperation as worktreeOperationImpl } from '../store/tables.js';
import { makeWorktreeCreator } from '../creation/execute.js';
import { makeWorktreeDeletion } from '../retirement/delete.js';
import { makeBranchDeletion } from '../retirement/branch.js';
import { BranchRefs } from '../contract/service/refs.js';
import { makeGitBranchRefs } from '../git/refs.js';
import { makeWorktreeStore } from '../store/registry.js';
import { makeWorktreeRowReader } from '../listing/rowReader.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';
import type { WorktreeFolder } from '../contract/service/creation.js';
import type { WorktreeThreadPort } from '../contract/service/finishingGate.js';
import { GraphDelivering, WorktreeDeparture, type FinishingGate } from '../contract/service/retirement.js';

export const worktreeStore = (membership: ProjectRootMembership['Service']) =>
  Effect.provideService(makeWorktreeStore, ProjectRootMembership, membership);

export const worktreeCreator = (input: {
  readonly intents: WorktreeIntents['Service'];
  readonly records: WorktreeRecords['Service'];
  readonly repositories: Repositories['Service'];
  readonly roots: FileRoots['Service'];
  readonly git: Git['Service'];
  readonly files: FileSystem.FileSystem;
  readonly paths: Path.Path;
  readonly units: MachineUnits['Service'];
  readonly publishedRoot?: RootPublished['Service'];
  readonly graph?: GraphDelivering['Service'];
}) =>
  Effect.provideContext(
    makeWorktreeCreator,
    Context.make(WorktreeIntents, input.intents).pipe(
      Context.add(WorktreeRecords, input.records),
      Context.add(Repositories, input.repositories),
      Context.add(FileRoots, input.roots),
      Context.add(Git, input.git),
      Context.add(FileSystem.FileSystem, input.files),
      Context.add(Path.Path, input.paths),
      Context.add(MachineUnits, input.units),
      Context.add(RootPublished, input.publishedRoot ?? { published: () => Effect.void }),
      Context.add(
        GraphDelivering,
        input.graph ?? { ready: () => Effect.void, deliver: () => Effect.succeed('ordinary'), sync: () => Effect.succeed('ordinary') },
      ),
    ),
  );

export const creationDriver = (input: {
  readonly worktrees: Effect.Success<ReturnType<typeof worktreeCreator>>;
  readonly environments: Environments['Service'];
  readonly stores: CoveredRepositories['Service'];
  readonly roots: FileRoots['Service'];
  readonly folder: WorktreeFolder;
}) =>
  Effect.provideContext(
    makeCreationDriver({ worktrees: input.worktrees, folder: input.folder }),
    Context.make(Environments, input.environments).pipe(
      Context.add(CoveredRepositories, input.stores),
      Context.add(FileRoots, input.roots),
    ),
  );

export const worktreeDeletion = (input: Parameters<typeof makeWorktreeDeletion>[0]) =>
  makeWorktreeDeletion(input).pipe(Effect.provideService(WorktreeDeparture, { departed: () => Effect.void }));

export const branchDeletion = (input: Parameters<typeof makeBranchDeletion>[0]) =>
  Effect.flatMap(makeGitBranchRefs({ purpose: 'worktree-finishing' }), (refs) =>
    makeBranchDeletion(input).pipe(Effect.provideService(BranchRefs, refs)),
  );

export const worktreeRowReader = (input: Parameters<typeof makeWorktreeRowReader>[0]) => makeWorktreeRowReader(input);

export const idleThreads = (overrides: Partial<WorktreeThreadPort> = {}): WorktreeThreadPort => ({
  live: () => Effect.succeed([]),
  placedIn: () => Effect.succeed([]),
  archive: () => Effect.void,
  stop: () => Effect.void,
  place: () => Effect.void,
  standingRoot: () => Effect.succeed(null),
  placing: () => Effect.succeed([]),
  threadsMoved: () => () => {},
  stopping: () => () => {},
  ...overrides,
});

export const openGate: FinishingGate['Service'] = { hold: (_key, work) => work };

export const branchesOver = (git: Git['Service']) => newBranches(git);

export const worktreeOperation = worktreeOperationImpl;
