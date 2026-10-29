---
id: 01a16a50-a501-7a13-b992-aba05134b560
title: submit_work lands a reference to an interface member declared by another session's uncommitted lines in another file
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The commit landed; in HEAD `rowReader.ts:129` uses `checkoutsMoved`, while `git grep checkoutsMoved HEAD -- apps/tagma/server/src/workspace` is empty — HEAD fails typecheck until pool lands the contract.",
    "command": "submit_work (session feed, thread 01a16a01-9313-71c1-8925-b1b67886edf5) in /opt/workspaces/runlith → commit 4fb9b31cea, already with the check from 5c2eac5aa2",
    "expected": "The `topology: checkouts.checkoutsMoved` line in worktrees/listing/rowReader.ts refers to the `CheckoutRows.checkoutsMoved` member declared only by session pool's uncommitted lines in workspace/contract/service/checkouts.ts; the landing refuses `lines-held` naming the holder, or carries the declaration."
  }
---
Filed from project `runlith`.

Repeat [[ef90b529]] in cross-file form. The check from 5c2eac5aa2 covers only same-file top-level declarations; cross-file references and interface members are task [[9ac959b7]], currently in work at carried-deps.
