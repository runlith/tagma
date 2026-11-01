---
id: 01a194e2-1ecd-771b-a83e-2ef3e93b534f
title: merge_worktree cannot pass a gated program that reads the base checkout's files
ord: 178
tags: ["reflection"]
fields:
  {
    "actual": "Refused inspection-failed: the program runs in the base checkout, which must equal the merged tree, while merge_worktree refuses a base with uncommitted lines on paths it writes; landed by hand with git merge --no-commit, bun install and submit_work (08a48f2be1).",
    "command": "merge_worktree rootId 01a194ac-add2-7482-91db-d3c2eb7b28b8 (runlith demo-seams → main, pin rule 8e15721e at gate)",
    "expected": "The merge is judged by its rules and lands, as submit_work of the same merged tree did."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

runlith's `checks/pin.ts` runs typecheck, scene checks and tests over the checkout's files and refuses until the checkout holds what the judged commit holds (submodule HEAD, root `package.json`/`bun.lock`, private workspaces). merge_worktree runs hooks in a private commit tree but runs the gated program with cwd = the base checkout root, which by its own base-dirty/base-held precondition still holds the pre-merge files. So any gated program that reads the working tree is unsatisfiable through merge_worktree; submit_work of an open merge passes because the files stand. Possible owner fix: run gated programs of a merge in the same commit tree the hooks get (with the submodule and install state), or let the merge proceed when the base's uncommitted paths already equal the merged tree.