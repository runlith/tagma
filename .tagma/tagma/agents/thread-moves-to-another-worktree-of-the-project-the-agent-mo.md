---
id: 01a14b6d-b277-75e0-b713-97e608c54f60
title: Thread moves to another worktree of the project; the agent moves itself and born threads
ord: 32
---
A thread can be moved to another worktree of the project, and from its next step commands and file tools work there; an agent moves itself and the threads it born that way.

**How.** The `move_thread` operation: `worktree` — `main`, a name from `list_worktrees`, or a root id; in the app — moving a thread to a worktree from the menu. Its own `operationKey` names the move: the same key with the same move answers what it achieved, with a different one — a refusal.

**Behaviour.** A thread with no running run moves at once. A running one finishes its current step on the old place and moves at the step boundary: the answer is `pending`, then under the same key — `applied` or `failed`. The thread's next turn learns where it now stands and where its earlier reads were. A new worktree is a separate act (`prepare_worktree` and `create_worktree`, or `worktree: new` at spawn).

**Limits and refusals.** An agent moves its own thread and its own born ones; a thread outside its own subtree — on the operator's word (`outside-subtree`); the operator moves any project thread. A thread born on a guest host is `guest-mobility`; a CLI thread with a running session is `harness-pinned` (the directory is set at launch). An unknown or unavailable worktree is `worktree-unknown` / `worktree-unavailable`.

Code: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts#THREAD_OPERATIONS, apps/tagma/server/src/threads/operations/acts.ts#ACT_PAIRS, apps/tagma/server/src/threads/targets/moves.ts, apps/tagma/app/src/lib/features/threads/worktrees/MoveToWorktree.svelte
