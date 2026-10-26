import { Context, type Effect } from 'effect';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RenameRemote, WorktreeRenamed } from '../wire/creation.js';
import type { FinishFailure } from '../wire/failures.js';

export class WorktreeRenames extends Context.Service<
  WorktreeRenames,
  {
    rename(projectId: number, rootId: RootId, name: string, remote?: RenameRemote): Effect.Effect<WorktreeRenamed, FinishFailure>;
  }
>()('tagma/worktrees/WorktreeRenames') {}
