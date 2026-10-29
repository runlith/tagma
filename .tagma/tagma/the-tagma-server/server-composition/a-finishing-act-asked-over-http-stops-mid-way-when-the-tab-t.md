---
id: 01a0d87f-c84c-76ca-bc59-abc7ae87f445
title: "A finishing act asked over HTTP stops mid-way when the tab that asked closes: the act must run to its end once started"
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d857-629f-7dc7-b6ca-04350f586b75",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/operations.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/operations/retirement.ts
---
Observed on 2026-09-25 in an isolated `tagma:try` server, while checking task 02ec90ae. The act was an archive of a worktree holding 30,000 uncommitted files, started from the sidebar. The browser that sent it was closed while the act was committing leftovers. `serve.log` shows `InterruptError: All fibers interrupted` at `archive_worktree` (operations/worktrees.ts). The worktree stayed listed with its files uncommitted and no leftovers commit. Nothing was lost, but the operator's archive silently did not happen.

The HTTP door runs the finishing act in the request's fiber, so a dropped connection interrupts it. That is between git steps, or while a git child runs. A long archive, delete, merge or clean-up should be detached from the request that asked for it once it has started, as the pending-merge queue already is. Start at the worktree routes in `apps/tagma/server/src/operations/worktrees.ts` and the HTTP handlers that call them.

Done when: an archive started from a tab that is then closed still ends archived, and its end reaches the feed.