---
id: 01a15bf5-e5af-7946-b9d4-f68f1075dfec
title: A turn opened by an agent task can be rolled back and branched from the interface again
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ba6-e1ea-79e0-be04-124abad7f40e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15ba6-6aca-7c3d-990f-13471510fceb
---
After `520511f49a` the birth task and `send_task` open a turn with a signal task, not a user message. The kit rewind picker takes only `user` entries, and `HistoryAttribution` sets `opens` only through `saidByReader`. So such a turn can no longer be rolled back to or branched from in the interface — before the change it could. Do: a turn opened with any sender's words rolls back and branches like the operator's turn.
