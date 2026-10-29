---
id: 01a12656-1bbe-7ce4-9b88-b00ee8139ff8
title: An agent write into `.git/` enters the checkout line accounting and hangs “Uncommitted” forever; the merge driver breaks and is restored by hand
ord: 138
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12656-47f2-7328-9278-c4af8b4a9a01",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
---
Found 10.10: the agent manually restored the broken `.git/tagma/merge-driver` (runtime/entry paths). `read_changes` now counts this path as `untracked · this session +2/−0`, and the thread forever shows "Uncommitted 1": git never commits `.git/` contents, the file cannot be deleted.

Two defects, each fixed at its owner:
1. Line accounting (module [[00ddf0e5|line authorship]]) must not judge paths inside the checkout's git directory (`.git/`, and for a worktree its gitdir): these are not working-tree files. Already recorded sessions' lines on such paths leave with the same fix.
2. Why the `merge-driver` broke (wrong paths to runtime/CLI after an install update?). The script writes `enforcement/commits/mergeDriver.ts` (`installCommitHooks`); it must stay correct after a Tagma update without hand-fixing — find the cause and close at the owner.

Done when: an integration test — an agent write into `.git/...` gives no holding and is invisible in Changes; a test/proof that the merge-driver script rewrites itself correct when the install changes; commit.
