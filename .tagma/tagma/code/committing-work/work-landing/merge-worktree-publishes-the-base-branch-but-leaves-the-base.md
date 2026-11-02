---
id: 01a19654-b900-7dd2-9ee1-92bd7f8ab4de
title: merge_worktree publishes the base branch but leaves the base checkout's index at the old tree, staging a revert of the merge
ord: 187
tags: ["reflection"]
fields:
  {
    "actual": "main moved to the merge, and `unsynced` named 7 paths with git's \"Entry 'bun.lock' not uptodate\". The index and working files stayed at the pre-merge tree, so `git status` in main showed the merge reversed as staged changes, covering a submodule, a source file, bun.lock and 4 .tagma files; the checkout had to be synced by hand with git checkout/reset/submodule update.",
    "command": "merge_worktree rootId=01a195df-ad2d-7458-adce-6989eb62241b (bun.lock rewritten in the base checkout between the base-dirty check and the sync)",
    "expected": "The merge either refuses before publishing, because the base checkout is dirty on a merge path, or it brings every path git can update to the merge and leaves only the conflicting path unsynced."
  }
---
Filed from another project. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The base-dirty refusal had passed moments earlier, after an agent restored bun.lock. Something rewrote bun.lock in the base checkout before the merge synced. The whole sync then aborted because of that one path, and the stale index for every other path was left standing. Any commit from main that takes the staged index would silently revert the merge. The 4 staged `.tagma` entries are still at their pre-merge content, because the agent may not touch .tagma.
