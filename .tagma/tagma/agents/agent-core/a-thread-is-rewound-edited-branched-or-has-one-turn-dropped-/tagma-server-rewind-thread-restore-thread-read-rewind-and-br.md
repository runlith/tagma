---
id: 01a0f262-5742-7fcc-9feb-206b5e147b03
title: "Tagma server: rewind_thread, restore_thread, read_rewind and branch_thread operations, entry rows keeping rewind marks, and the history store applying splice"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f263-5e5c-7388-9288-c0101d6b581a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f262-03db-7bb1-84f3-665d4263865b
  - kind: waits-on
    to: 01a0f262-5685-7e97-b058-bd0ba1b50e86
  - kind: waits-on
    to: 01a0f262-56d2-75eb-bf30-6077fef04cdb
---
Build the Tagma half of §4.2–4.4. Operations beside `stop_run` in the threads module (socket, operator, keyed by call): `rewind_thread { threadId, at, scope, revertLines? }`, `restore_thread`, `read_rewind` (the kernel preview plus the change record's file facts and the graph acts the thread's session signed in those runs), `branch_thread { threadId, before }`. `thread_entry` gains the rewind mark (migration); `native-harness/transcript/rows.ts` marks and clears instead of deleting; `native-harness/transcript/history.ts` applies `splice`. `rewind_thread { revertLines: true }` calls `revert_lines` after the rewind lands and answers both.

Waits on the kernel task's contract and the change-record task.

Done when acceptance criteria 1, 3 and 7 hold at the server (rows after restart re-derive equal to the kernel fold).