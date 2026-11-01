---
id: 01a194f7-919b-75c7-8e63-f44f47e6b427
title: A linked-worktree cherry-pick hook called a server address unavailable during replacement
ord: 1224
tags: ["reflection"]
fields:
  {
    "actual": "Cherry-pick 688b6593 landed as 2db665e854, but its hook reported no response at http://127.0.0.1:5633/api/op/record_commit; a serving-server process change was subsequently observed.",
    "command": "git cherry-pick 688b6593 d1c68f36 fa58eec8 1073960f 695b4037 73d86fe4 88abcd36 4c4e2ccf",
    "expected": "The completed cherry-pick is recorded against the active Tagma installation, or the hook reports its unrecorded outcome without losing the commit identity."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T02:30:59.745Z, from 2c34a6f95.

The Tagma-created cpu-event-bisect worktree retained the new commit. d1c68f36 then reached a separate ordinary content conflict in journal/log.ts. The first reflection filing itself refused graph-pool with OwnGitFailed while trying diff-index against outer commit 2db665e854 in cpu-event-bisect/.tagma. The current filing runs after the thread moved away from that conflicted checkout.