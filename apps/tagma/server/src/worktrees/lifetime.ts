import { Context, Effect, FiberSet, Layer } from 'effect';
import { assembleWorktrees } from './assembly.js';
import { BranchTitles, NewBranches } from './contract/service/branches.js';
import { WorktreeOwners } from './contract/service/owners.js';
import { FinishingGate, WorktreeRetirement } from './contract/service/retirement.js';
import { SetupSettlements } from './contract/service/setup.js';
import { UnbornReleasing } from './contract/service/finishingGate.js';
import { Worktrees } from './contract/service/creation.js';
import { WorktreeRows } from './contract/service/listing.js';
import { WorktreeRenames } from './contract/service/renames.js';
import { WorktreeCleanup } from './contract/service/cleanup.js';
import { PlaceSpace } from './contract/service/space.js';

export const worktreeOwnersLayer = Layer.effectContext(
  Effect.gen(function* () {
    const assembled = yield* assembleWorktrees;
    const renameFork = yield* FiberSet.makeRuntime<never, void, never>();
    return Context.make(WorktreeOwners, assembled).pipe(
      Context.add(Worktrees, assembled.creation),
      Context.add(WorktreeRows, Context.get(assembled.owners, WorktreeRows)),
      Context.add(WorktreeRetirement, assembled.retirement),
      Context.add(FinishingGate, assembled.gates),
      Context.add(WorktreeRenames, Context.get(assembled.owners, WorktreeRenames)),
      Context.add(WorktreeCleanup, Context.get(assembled.owners, WorktreeCleanup)),
      Context.add(PlaceSpace, Context.get(assembled.owners, PlaceSpace)),
      Context.add(NewBranches, assembled.newBranches),
      Context.add(UnbornReleasing, { release: (rootId) => assembled.unborn.release(rootId) }),
      Context.add(SetupSettlements, { on: assembled.onSetupSettled }),
      Context.add(BranchTitles, {
        titled: (threadId, title) =>
          Effect.sync(() => {
            renameFork(Effect.asVoid(assembled.branches.titled(threadId, title)));
          }),
      }),
    );
  }),
);
