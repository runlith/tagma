---
id: 01a17c13-c8ce-789a-b0a8-ec39fc7e67f8
title: Finishing someone else's merge check runs git in a just-deleted worktree and drops the whole worktree feed
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17c14-a858-7b36-9315-5fac4054cacb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16af5-72c5-7950-b64c-533614455f40
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/feed.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/membership.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/mergeChecks.ts
---
Red once in a batched `check:change` run (worker 38376, 42nd file): `worktrees/listing/rowReaderWorktrees.itest.ts` › "listed worktrees > a created worktree lists idle … missing when its folder goes …" fails with `GateRefusal: worktree-unavailable: fatal: cannot change to '…-other': No such file or directory (the storage reading is what stopped)`. Separately, repeating the same 42-file sequence and 30 repeats of the file are green: no reproduction.

The chain through the code. This is the conclusion: the failing run's git trace was not kept.
- `feed.ts:249–251` turns any merge-check completion into a shared `check` event → `membership.measureMoved` (`:220`).
- It remeasures all trees (`membership.ts:397`). It trusts the `sight.present` cache (`:159–163`) and calls `reads.verdict(…, true)`, which is allowed to start a check.
- `mergeChecks.ts:477–491` rechecks witnesses and starts `fingerprint` → `git -C <deleted directory>` (`:219–251`).
- The failure is not caught here, unlike state reading (`membership.ts:242–250`): it drops the feed queue (`feed.ts:263–265`) and all readers (`windows.ts:145–150`). `rowReader.ts:126–127` also signs the git failure as "storage reading".

This breaks the promise of [[91dd880e]]: "another check's completion never runs git in it and never ends the feed".

What to do at the feed's owner:
- a check completion projects the stored verdict without starting a new check (`standing(…, start=false)`), and updates only its own line;
- a missing directory still converges to `missing`.

Test: extend `feed.itest.ts` › "a missing worktree stays in the live feed when another merge check finishes" — delete the directory while the cache still counts it present, and finish someone else's check before topology reconciliation; the subscription stays alive and then shows `missing`.
