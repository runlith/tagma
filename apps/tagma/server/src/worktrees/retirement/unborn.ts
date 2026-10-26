import { Cause, Effect, FiberSet } from 'effect';
import type { SetupWaitFailure } from '../setup/drive.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeDeleted } from '../contract/wire/retirement.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import { WorktreeRecords } from '../contract/service/worktrees.js';

export type UnbornRelease =
  | { readonly status: 'released'; readonly rootId: RootId; readonly branch: WorktreeDeleted['branch'] }
  | { readonly status: 'kept'; readonly rootId: RootId; readonly reason: string };

export type UnbornWorktrees = {
  readonly release: (rootId: RootId) => void;
  readonly releasing: (rootId: RootId) => Effect.Effect<UnbornRelease, SetupWaitFailure>;
};

export const makeUnbornWorktrees = Effect.fnUntraced(function* (input: {
  readonly settled: (rootId: RootId) => Effect.Effect<unknown, SetupWaitFailure>;
}) {
  const { settled } = input;
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const { placedIn } = yield* WorktreeThreads;
  const { delete: remove } = yield* WorktreeRetirement;
  const fork = yield* FiberSet.makeRuntime<never, void, never>();

  const releasing = Effect.fn('UnbornWorktrees.releasing')(function* (rootId: RootId): Effect.fn.Return<UnbornRelease, SetupWaitFailure> {
    const kept = (reason: string): UnbornRelease => ({ status: 'kept', rootId, reason });
    yield* settled(rootId);
    const record = yield* units.read((unit) => records.byRoot(rootId, unit));
    if (record === null) return kept('no worktree record answers this root');
    const placed = yield* Effect.result(placedIn(record.projectId, rootId));
    if (placed._tag === 'Failure') return kept(`the threads placed there could not be read: ${placed.failure.message}`);
    if (placed.success.length > 0) return kept('a thread stands in it, so it was taken up after all');
    const removed = yield* Effect.result(remove(record.projectId, rootId));
    if (removed._tag === 'Failure') return kept(removed.failure.message);
    return { status: 'released', rootId, branch: removed.success.branch };
  });

  const unborn: UnbornWorktrees = {
    release: (rootId) => {
      fork(
        releasing(rootId).pipe(
          Effect.flatMap((outcome) =>
            outcome.status === 'released'
              ? Effect.logInfo('a worktree made for a birth that failed was released', outcome)
              : Effect.logWarning('a worktree made for a birth that failed was kept', outcome),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning('a worktree made for a birth that failed could not be released', { rootId, cause: Cause.squash(cause) }),
          ),
        ),
      );
    },
    releasing,
  };
  return unborn;
});
