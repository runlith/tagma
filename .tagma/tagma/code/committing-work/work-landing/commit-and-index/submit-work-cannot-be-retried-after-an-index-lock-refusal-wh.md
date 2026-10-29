---
id: 01a0d04b-4350-720d-b7b8-e30b0c1d6627
title: "submit_work cannot be retried after an index.lock refusal when the session deleted files: git add refuses the already-staged deletions"
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "The retry refused \"git said: fatal: pathspec 'apps/tagma/app/src/lib/features/checkout/CheckoutSection.svelte' did not match any files\". The first attempt had already run `git add` over all 58 paths — staging five deletions — before the commit hit index.lock. On the retry, `git add -- <deleted path>` finds the path in neither the index nor the worktree and refuses the whole add. The work was delivered by hand with `git commit -- <paths>` (2ca48fb3f6).",
    "command": "submit_work (no paths) twice: the first answered refused with \"another commit was running here; run it again — Unable to create .git/index.lock\"; the second, run again as told",
    "expected": "The retry the refusal names commits the session's paths, deletions included."
  }
---
Filed from project `runlith`.

In apps/tagma/server/src/harness/submitWork.ts, `add` and `commit` run as two git calls under one permit. When the second fails, the first has already moved the index, and nothing brings it back. Either the add should tolerate a path whose deletion is already staged (`git add -A -- <paths>` or `--ignore-missing`), or a single `git commit -- <paths>` should replace add-then-commit, as the manual fallback does. The refusal's own advice, "run it again", cannot succeed in this state.