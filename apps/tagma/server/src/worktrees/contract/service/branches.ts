import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { BranchTwins } from '../../../graph/contract/service/branchTwins.js';

export class NewBranches extends Context.Service<
  NewBranches,
  {
    named(path: string, prefix: string, name: string): Effect.Effect<string, GateRefusal>;
    generated(path: string, prefix: string, name: string, key: string): Effect.Effect<string, GateRefusal>;
    start(path: string): Effect.Effect<string, GateRefusal>;
  }
>()('tagma/worktrees/NewBranches') {}

export class BranchTitles extends Context.Service<
  BranchTitles,
  { readonly titled: (threadId: string, title: string) => Effect.Effect<void> }
>()('tagma/worktrees/BranchTitles') {}

export class BranchTwinning extends Context.Service<BranchTwinning, { readonly twins: BranchTwins }>()('tagma/worktrees/BranchTwinning') {}
