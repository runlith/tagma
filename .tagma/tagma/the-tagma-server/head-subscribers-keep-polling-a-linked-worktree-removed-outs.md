---
id: 01a1958b-3761-7d14-b75f-56c78b0701c1
title: HEAD subscribers keep polling a linked worktree removed outside Tagma until a coverage change
ord: 182
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1957b-8300-764e-a4f0-bed70c7e4c33",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1957b-3bed-7d31-8e61-2156fec7a46b
---
5e687ee5f3 drops a vanished checkout from the re-measure driver's own HEAD watcher and journal. The other subscribers of `watch/heads.ts` for the same folder still release it only on a coverage change: change-record judges, intake heads and retirement. A plain `git worktree remove` outside Tagma never makes a coverage change, so serve.log keeps polling HEAD of the missing folder every minute. An app that adds and removes a linked worktree on a schedule leaves one such folder per run. The watcher's explanation treats a missing folder as a possible move, so the fix has to tell "moved" from "removed for good" first. For a linked worktree, that can be read from the shared repository's `git worktree list`, which no longer names the folder after a remove.