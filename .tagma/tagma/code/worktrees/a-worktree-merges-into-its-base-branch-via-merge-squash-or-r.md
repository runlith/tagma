---
id: 01a14c13-c481-7acc-8aa6-03cbaf2058f5
title: A worktree merges into its base branch via merge, squash, or rebase — only after checks that may refuse, and under the law of the merged tree
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ccace11ae4
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d0ad0de7bf
sources:
  - kind: dir
    ref: apps/tagma/server/src/landing/merge
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/FinishDialog.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/Finishing.svelte.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
    symbol: LANDING_OPERATIONS
---
**Value.** A finished branch lands on the base in a single act, and nothing is published until the conflict check, the state of the base checkout, the project rules, and the hooks have passed.

**How.** The Merge… dialog on the board, in the row menu, and in the thread panel's finish strip; the `merge_worktree` operation.

**Behaviour.**
- Before merging, the dialog lists: whether anyone is working in the worktree, uncommitted lines there, the merge check, what is running in the base checkout; the mode, message, and "delete after merge" are chosen in it.
- The merge takes the branch as committed: a working agent and uncommitted lines are not part of it. Before git, the following refuse: a conflict, an operation in progress, staged lines or another session's uncommitted lines on the merge paths in the base checkout.
- The merged tree is judged by the rules in effect before `merge_worktree` (A4), against the graph the merged tree itself carries; if both sides changed the graph, the merge first takes the base into the branch.
- The merge commit runs hooks in the base's commit tree; commits carry the user's identity and are signed, as with `git commit`. The base moves only by compare-and-set from the verified tip; a published merge stands, and one interrupted by a restart is finished at startup.
- After the merge the worktree is deleted if so chosen; a failed deletion leaves the merge in place.

**Limits.** A rebase that would yield a different tree than the merge refuses, as does a branch carrying nothing new for the base. A thread cannot merge with deletion of the worktree it stands in.
