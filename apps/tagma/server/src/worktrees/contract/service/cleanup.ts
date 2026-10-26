import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { FinishingPlace } from '../wire/mergeTypes.js';
import type { CleanedWorktree, CleanupCandidate } from '../wire/cleanup.js';
import type { WorktreeRowRefusal } from './listing.js';
import type { FinishFailure } from '../wire/failures.js';

export class WorktreeCleanup extends Context.Service<
  WorktreeCleanup,
  {
    places(projectId: number, rootIds: readonly RootId[]): Effect.Effect<readonly FinishingPlace[], FinishFailure>;
    candidates(projectId: number, idleAfterDays: number): Effect.Effect<readonly CleanupCandidate[], GateRefusal<WorktreeRowRefusal>>;
    clean(
      projectId: number,
      rootIds: readonly RootId[],
      idleAfterDays: number,
      end?: TerminalActor,
    ): Effect.Effect<readonly CleanedWorktree[], GateRefusal<WorktreeRowRefusal>>;
  }
>()('tagma/worktrees/WorktreeCleanup') {}
