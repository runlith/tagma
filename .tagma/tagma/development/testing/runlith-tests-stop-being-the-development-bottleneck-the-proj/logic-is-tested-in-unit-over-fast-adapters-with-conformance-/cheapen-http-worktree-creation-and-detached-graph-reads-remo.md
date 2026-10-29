---
id: 01a16dee-ddcc-7b00-a611-1a89daa51185
title: Cheapen HTTP worktree-creation and detached-graph reads, remove the graphless-door repeat
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-9d53-71ef-9314-aa7e08ed63ca",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
In the current order after cutting parallel work, worktreesDoor, graphFormat and graphlessDoor dissected: one creation and replay path over HTTP, two detached reads with write refusals, removal of the held-step scenario duplicate from idleCopies. The other 13 files of the source package returned to the lead unchanged. Base cost of these three files — 53.9 s CPU; after — 32.5 s CPU on first single seed=1 runs under load (1.66x), including two cold worlds. Ledger: x10/x-http-heavy.tsv. Both remaining files passed individually through testbed with --parallel=1 on seeds 1, 2, 3; seed=2 graphFormat confirmed by the exact run of owner MergeGit. Commit 187ac02d81 holds three files, no uncommitted lines from this work.
