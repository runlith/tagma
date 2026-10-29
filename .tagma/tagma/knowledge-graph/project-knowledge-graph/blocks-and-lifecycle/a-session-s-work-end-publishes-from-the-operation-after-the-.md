---
id: 01a16483-20d9-7168-9ede-46440b64f680
title: A session's work end publishes from the operation after the record, with one listener set per machine
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/workEnds.ts
  - kind: file
    ref: apps/tagma/server/src/graph/work/tasks/ended.ts
---
The lower module does not know `threads`, yet a session's work end must reach a subscribed thread, so `WorkEnds` is a `graph` port: the subscriber gets `{threadId, projectId, block, title, word, commit}` and unsubscribes with the returned function. The `finish_block` / `close_block` operation publishes (`announceEnd`) after `Tasks.finish` or `Tasks.close` returned: the graph record is already committed, and a subscriber failure, which the shared `subscribersOf` from `platform` writes to the log, does not roll it back.

Not `Tasks` but the operations publish: `Tasks` lives in the project graph copy, while the listener set must be one per machine — so `WorkEnds` lives in the module's installation lifetime, next to the copies, not inside them. The event comes only from a thread's call and only for a node whose tag binds `core/work` (tasks; specs and ideas close with no event). An operator's call or an off-thread session's call gives no event. A task end through `supersede_block` or batch publishes no event: those are different acts.

`word` is the status word the task ended on (`done` or `closed` per the tag dictionary), `commit` the commit that recorded `finish_block`, and `null` on `close_block`. `projectId` is the thread's home, not the block's project: a thread closes a foreign project's task under its own address.
