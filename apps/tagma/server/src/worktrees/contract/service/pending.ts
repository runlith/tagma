import { Context, type Effect } from 'effect';
import type { PendingMerge } from '../wire/mergeTypes.js';

export class PendingMergeReads extends Context.Service<
  PendingMergeReads,
  {
    readonly ofProject: (projectId: number) => Effect.Effect<readonly PendingMerge[], { readonly message: string }>;
    readonly onMoved: (listener: (projectId: number) => void) => () => void;
  }
>()('tagma/worktrees/PendingMergeReads') {}
