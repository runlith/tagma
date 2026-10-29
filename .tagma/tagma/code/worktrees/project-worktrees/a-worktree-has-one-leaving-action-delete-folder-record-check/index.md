---
id: 01a1361f-e541-797c-b68e-d735674c0c58
title: "A worktree has one leaving action — 'Delete': folder, record, checks, and flows leave; the branch stays only with unfinished work; no archiving"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees/retirement
  - kind: file
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/retirement.ts
---
A worktree has one leaving action — **"Delete"**. It removes the worktree entirely: the folder with everything in it, Tagma's record of it, its merge checks and graph commits. "Archive" no longer exists for worktrees: no button, no operation, no archived list, no restore. Archiving flows is unchanged — it is a conversations trash bin, and it is clear.

## Why

The operator sees "Archive" and "Delete" in the interface and cannot say how they differ, and no user could. The difference right now: archiving commits the uncommitted into the branch, removes the folder, and keeps the branch and the record for `restore_worktree`; deletion does the same and also deletes the branch when it is merged. Beside them stand `forget_worktree`, `restore_worktree`, and `list_archived_worktrees`. Four concepts where a person expects one. A half-archived worktree stays alive meanwhile: `optional-fields` was archived on October 11 and still stands in the list on October 13, receiving merge checks and graph commits. On October 13 `delete_worktree` refused on it five times in a row with `git-refused` ("contains modified or untracked files"). The merge check kept writing its `.merge_file_*` files into the folder and restarting whenever interrupted. For `tagma-holder-impl-f0e304` git dropped the registration, but the folder with such files remained, and dozens of temp files were committed into the branch as "the work left uncommitted".

## What "Delete" does

1. It stops what works in the worktree: agents, terminals, and commands — as on leaving today.
2. Uncommitted changes are committed into the branch. That is the only thing kept, and only so a click never destroys someone else's unfinished writing. A worktree without a branch (detached) gets a new `tagma/kept/<name>-<commit>` branch for this commit. Deletion refuses only when saving is impossible: git could not read what is uncommitted in the folder, or a git operation (merge, rebase) runs in the folder.
3. The folder is deleted with everything inside, including ignored files, leaving not even an empty one. Files in the folder never stop deletion: the unfinished is already saved in step 2, the rest is removed. When the folder is already gone, deletion simply runs to the end — there is no separate "forget".
4. The branch is deleted when merging it would change nothing in the base except Tagma's graph. Tagma's own commits do not count as work and do not hold the branch: graph commits (`tagma: graph @ …`) and temp-file commits Tagma itself left in the folder. A branch whose merge would change something stays an ordinary git branch — no folder, no Tagma line, no checks — and the answer names it and its commits. So one button can never irrecoverably destroy unfinished work, and a left branch costs nothing and bothers nobody.

The approval mode decides whether the operator is asked:
- bypass never asks;
- trust asks once and only when the folder holds uncommitted or untracked files (`folder-dirty`). Clean deletion goes without a question;
- review, like for any write, asks one question, naming uncommitted files among its reasons when there are any.

Deletion and cleanup have no separate destructive confirmation: the CLI does not require `--yes`. From the moment deletion starts, neither the merge check nor the graph writes anything into the folder.
5. The flows that stood in the worktree are archived.
6. Tagma's worktree record is deleted. Nothing remains, neither in the list nor in the archive.

No confirmation beyond the mode question: one button — one action. Nothing to lose: the unfinished stays in the left branch.

A branch Tagma did not create is never deleted by Tagma, and outside checkouts (`external`) are not led away, as before.

## What leaves

- The `archive_worktree`, `restore_worktree`, `forget_worktree`, `list_archived_worktrees` operations. Their work is part of `delete_worktree`, and there is no restore.
- `clean_up_worktrees` deletes candidates with the same action; "Idle Nd — archive?" becomes "Idle Nd — delete?".
- The merge variant "archive after merge" becomes "delete after merge".
- The archived-worktrees section in the app, the words archive/archived in code, wire, interface, and the worktree module graph.
- Stored archived-worktree records are removed by one migration; their git branches stay as they stand.

## Construction

The owner is the worktree module (`apps/tagma/server/src/worktrees/retirement`). Deletion is one act with two phases per the module rule: first the world is read, then the record is fixed. Landing and the app call only it. Refusal texts and `unblock` across the server stop naming the departed operations.

## Proof

The performer proves through the operation:

- merged branch (or one carrying only Tagma graph commits) → no folder, no branch, no record; flows in the archive;
- branch carrying its own commits → no folder, no record; the branch stands, and the answer names its commits;
- uncommitted changes → they are in the left branch's commit;
- folder already gone → the record is deleted;
- after migration the store holds no archived worktree records, and the operation catalog holds none of the departed names.

The operator checks directly: the worktree has one "Delete" button in the interface, and after it the worktree is nowhere to be seen.
