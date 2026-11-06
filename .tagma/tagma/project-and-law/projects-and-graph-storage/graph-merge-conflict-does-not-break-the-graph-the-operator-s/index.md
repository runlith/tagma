---
id: 01a14c14-a11c-7ce8-9d84-63271278b347
title: "Graph-merge conflict does not break the graph: the operator sees a banner and assigns analysis to an agent with one button"
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6328ba8c9922
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/Recovery.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/RecoveryBanner.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/cli/files.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/recovery.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/conflicts.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/merges.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/routes.ts
    symbol: ROUTE_OPERATIONS
---
**Value.** A conflict of two knowledge branches neither makes the graph unreadable nor needs hand git commands: the current graph stays available, and an agent with both sides takes the analysis.

**How.** A banner over the project window with Assign to agent or Open recovery (`start_graph_recovery`); `read_graph_recovery`; finishing — `resolve_graph_conflict`, `tagma files resolve`.

**Behaviour.**
- The stealth merge runs in a separate recovery worktree; the served branch changes only after success, and the conflict record survives restart and reads without the graph mirror.
- The banner shows the first unfinished case and the count of the rest; pressing again opens the same recovery thread, not a new one.
- Publishing the decision checks block files and the form marker and never overwrites work that appeared in the goal after analysis started.
- In team storage `resolve_graph_conflict` checks graph files and stages only them, leaving the merge commit to the repository merge owner; a team project's stealth blocks recover like stealth storage, and their pending recovery is published first.
- The recovery case for a branch deleted from the repository clears automatically on the next sync.

**Limits.** Neither side is picked automatically. The banner and recovery thread exist for stealth storage and a team project's stealth blocks; a conflict of a team project's `.tagma` is an ordinary git-merge conflict. A team project's banner follows its stealth blocks' recoveries only where their layer already stood when the window subscribed.
