---
id: 01a14c13-c481-7acc-8aa6-03ba0a234a8f
title: Repository hooks run in the commit's private tree and don't see other sessions' unfinished work
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/hooks.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/publish.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/reshaping.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/commitTrees.ts
---
**Value.** Pre-commit frameworks and lint-staged, which lift the uncommitted off disk for the hook's duration, don't lose other agents' lines: one session's commit doesn't touch others' files.

**How.** Automatic, on every Tagma commit: the `submit_work` landing, `commit_checkout`, the `pull_checkout` merge commit, and worktree merge in merge mode.

**Behaviour.**
- One private working tree per checkout holds the commit version, sees the repository refs and links to its ignored (`node_modules`, `.venv`) so the hook finds its tools.
- What the hook staged enters the commit; what it fixed past the index reaches the working files as uncommitted work — on refusal too. The answer names such files and those left as they were.
- `post-commit` and `post-merge` run after publication in the same tree; `post-commit` edits go into the working files as nobody's lines.
- The commit carries the user's git identity and is signed where `commit.gpgsign` asks; a signature git couldn't make refuses with the signer's words.
- Two commits of one checkout don't share the tree at once; a hook outliving the ceiling stops with its process group.

**Limits.** A hook's write through a link into the ignored lands straight in the checkout. A process that left the group (a daemon) isn't caught by stopping. Pull stopped by a conflict merges straight into the checkout, like git.
