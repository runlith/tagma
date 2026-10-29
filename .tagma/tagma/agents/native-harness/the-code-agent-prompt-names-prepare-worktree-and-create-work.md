---
id: 01a12c2b-a4ed-7a34-84cb-20e9e33e001a
title: "The `code` agent prompt names prepare_worktree and create_worktree, which its capabilities do not mount: library.itest.ts fails"
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c17-6a44-7b9d-8339-97fdddaf4476
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/library.itest.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/doctrine/branchesAndWorktrees.ts
---
`bun test ./src/composition/testing/native-harness/library.itest.ts` in `apps/tagma/server` fails on HEAD 9c5a0bf4be: the test "every agent this server ships is a read-only built-in of any project, whose prompt names only operations its capabilities mount" answers `{ agent: "code", unmounted: ["prepare_worktree", "create_worktree"] }`. The "Branches and Worktrees" section (`branchesAndWorktrees.ts`) lands in the `code` agent prompt, but it has no capability mounting these operations — the prompt offers tools the run does not have.

Decide what is right for `code`: withhold that section (or its new-worktree line) from it, or mount the operations. Start with how the section is selected for the agent (its capabilities' `sections`) and what the `worktrees` capability mounts.

Done when the test passes and the `code` prompt names no operations it is not given.
