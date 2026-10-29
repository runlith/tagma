---
id: 01a14a43-13c5-7972-a767-da72c37c24a1
title: "Merging a worktree where only graph files conflict deadlocks: merge_worktree sends to update_worktree, which demands a thread inside the worktree"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "merge_worktree refused merge-conflicts over three .tagma files (two modify/delete, one add/add in tags/software-development.md; the code merges cleanly) and offered update_worktree; update_worktree refused no-lead-thread: 'start a thread in this worktree'. The operator ordered the merge, yet the merge act first demands settling a thread in the worktree",
    "command": "merge_worktree({rootId: \"01a14044-fc1a-7335-9b7f-d1103a48ba93\", after: \"keep\"}) → update_worktree({rootId: \"01a14044-fc1a-7335-9b7f-d1103a48ba93\"})",
    "expected": "Conflicts only in Tagma's own storage (.tagma) Tagma resolves itself in one merge act — by its description merge_worktree first merges base into the branch when the graph changed on both sides; or unblock leads to an act that runs without preparation"
  }
---
Filed from project `runlith`.

The merge stood queued since October 15 (1248 attempts, all refused base-staged). The check order showed only the first refusal: after the staged file was committed in main, the second surfaced — graph conflicts. The thread that once worked in this worktree no longer stands there, so the only way out of unblock is moving an unrelated thread into the worktree or starting a new one, just to resolve conflicts in files the server itself writes and that agents are forbidden to stage/commit. That is an enabling step before an act the operator already named (rule 0f144655).
