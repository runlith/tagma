---
id: 01a128f9-2a8b-7e38-9f74-661ffb265537
title: submit_work names paths whose lines «still stand uncommitted» while git diff against HEAD is empty
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "`left` named six paths: three under apps/tagma/server/src/workspace (checkouts/rows.ts, watch/shared.ts, watch/tree.ts), where the session added debug lines and then removed them with edit, so each file equals HEAD again, and three files the commit had just carried (feed.ts, membership.ts, publication.ts). `git diff --stat` on both directories printed nothing.",
    "command": "submit_work(checkout: /opt/workspaces/runlith, paths: [apps/tagma/server/src/worktrees/listing]) → landed 18fed19d4f",
    "expected": "The answer's `left` lists only paths where this session's lines still differ from HEAD; after the commit, and with temporary debug lines reverted to HEAD in three other files, `left` is empty."
  }
---
Filed from project `runlith`.

Same shape as the work in 2b7c48a9 (phantom-held after landing and after a file returns to HEAD). Cost: one extra git call to tell a real leftover from a phantom; otherwise a session would believe it still holds lines and could not end its run cleanly.