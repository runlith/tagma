---
id: 01a14bae-6720-7d62-897a-929587c73bc6
title: Thread moves to another worktree or another project; the agent moves itself and threads it spawned
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: supersedes
    to: 01a14b6d-b277-75e0-b713-97e608c54f60
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Menu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/MoveToWorktree.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/homes.ts
  - kind: file
    ref: apps/tagma/server/src/threads/targets/moves.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
    symbol: THREAD_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/acts.ts
    symbol: ACT_PAIRS
---
**Value.** Work started in the wrong checkout or wrong project continues in the right place with no new thread and no lost context: the same conversation, the same tasks, the same uncommitted lines.

**How.** From the thread menu — moving to a worktree or to another project (to its main); the `move_thread` operation, to another project with `home`. The operator asks the agent to move itself or its sub-agent, and the agent calls the same operation.

**Behaviour.** A free thread moves at once, a running one at a step boundary; the next turn learns where it now stands and where its earlier reads were. A new worktree is created as a separate act. Moving to another project changes the thread's home: the thread joins that project's list, its next step runs under that project's law, command rules, settings, and agents, while its own command rules and uncommitted lines stay with it. The folder and pinning in the old list are dropped; threads it spawned stay in their homes; the thread's open feed moves to the new project on its own.

**Limits.** An agent moves itself and the threads it spawned, another's thread — on the operator's word; the operator moves any project thread. A Tagma agent on any transport (Claude Code, Cursor, OpenCode over ACP) moves like a native one. Threads on a sandbox do not move, nor does a CLI with its own agent while its turn runs (terminal CLI, Devin over ACP): such an agent works in the folder it was launched in. A thread does not move to another project while holding a terminal, a background running command, or an unresolved custody handover: execution stays in the project where it runs. A running thread whose run ended before the step boundary stays in the old project whole. The thread's frozen prompt is not rebuilt on moving.
