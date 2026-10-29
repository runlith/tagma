---
id: 01a14c13-c481-7acc-8aa6-03c86c0ffc00
title: The operator and the agent start a worktree on a new or existing branch, and Tagma prepares it for the first turn
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929587c73bc6
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bccc335a96
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c98a57314e
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d2b3b3a55f
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees/creation
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardState.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/NewWorktreeDialog.svelte
  - kind: file
    ref: apps/tagma/server/src/worktrees/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/setup/drive.ts
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/creation.ts
    symbol: CREATION_OPERATIONS
---
**Value.** Parallel work moves to a separate checkout with its own branch without touching the main one; the project sets up `.env` copying and an environment preparation command before the first turn.

**How.** New worktree on the board and in the switcher, "Create & go" on a branch without a worktree; the agent runs `prepare_worktree`, `create_worktree`, then `move_thread` (moving the thread is A1). Settings `worktrees.folder`, `worktrees.branchPrefix`, `worktrees.setupCopy`, `worktrees.setupRun`.

**Behaviour.**
- Creation is two acts: preparation permits and records the storage, folder, ref, and base, and exactly that is approved; creation reserves the name and ref, re-reads everything, and runs git with the repository's config, hooks, and filters, without force or fetch. Repeating the same act answers with the same outcome, not a second checkout.
- A folder without an explicit place goes to the project's worktree folder, outside every repository, and is named after the branch; a new branch gets the project prefix.
- A new branch of a project whose graph lives in the tree starts from the base's current graph: the graph is first delivered at the base, and the base moves only through commits of a single graph.
- Setup copies ignored files from the main checkout by mask and runs one `worktrees.setupRun` command; an empty setting runs no command. The first turn of a native thread in the worktree waits for setup, and a setup failure lands in its instructions. A changed setting applies to new worktrees; an existing checkout is prepared by running the project command directly.
- The creating thread stays where it stood; the worktree keeps its color for life.

**Limits.** An outcome git never brought to a clear state stays unclear: the folder and ref are held until recovery or release, and nothing is deleted. A checkout made with `git worktree add` outside Tagma is visible and fits as a thread's place, but Tagma neither merges nor deletes it.
