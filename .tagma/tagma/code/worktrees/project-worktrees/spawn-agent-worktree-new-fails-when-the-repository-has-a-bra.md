---
id: 01a0d591-d830-7a7c-ae68-b453050eebe9
title: "spawn_agent worktree \"new\" fails when the repository has a branch named `tagma`: the child's branch `tagma/<name>` cannot coexist with ref `refs/heads/tagma`"
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "worktree-unresolved: `git worktree add -b tagma/runtime-review-048411` exited 255 with \"fatal: 'refs/heads/tagma' exists; cannot create 'refs/heads/tagma/runtime-review-048411'\". The child was not started. Recovery took three manual operations: read_worktree_operation, then prepare_worktree in detached mode, then create_worktree. abandon_worktree refused as `settled`, although the spawn error had named abandon_worktree as a way on",
    "command": "spawn_agent {agentId: \"tagma\", name: \"runtime-review\", worktree: \"new\"} in another project; repository has a local branch `tagma` (checked out in another worktree)",
    "expected": "A fresh worktree for the child, under a branch name that does not collide with existing refs, or a namespace chosen around the collision"
  }
---
Every `worktree: "new"` spawn in a repository with a `tagma` branch fails the same way, because git refs cannot be both a file and a directory. The error's own `unblock` suggested abandon_worktree for "a creation that left nothing", and the tool then refused it because the creation had already resolved as failed. The hint and the refusal disagree.