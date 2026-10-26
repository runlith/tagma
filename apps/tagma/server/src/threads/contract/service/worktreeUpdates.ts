import { Context, type Effect } from 'effect';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { FinishFailure } from '../../../worktrees/contract/wire/failures.js';
import type { WorktreeUpdateHanded } from '../../../worktrees/contract/wire/retirement.js';

export class WorktreeUpdates extends Context.Service<
  WorktreeUpdates,
  {
    readonly update: (projectId: number, rootId: RootId, sender: string | null) => Effect.Effect<WorktreeUpdateHanded, FinishFailure>;
  }
>()('tagma/threads/WorktreeUpdates') {}
