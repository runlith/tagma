---
id: 01a151de-5a4c-7c77-b800-6ae0a49da04b
title: "Moving the graph store (set_project_storage) under a working thread drops its run: the thread reads the old store's closed connection"
ord: 225
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151de-811c-7929-a432-1db8c6cdfd59",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/storageMove.itest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/pool.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/context.ts
---
Reproduced on tagma:try (root `~/.tagma-demo-world`, `data/serve.log`): the `brightdesk` project thread worked (Sol xhigh, run 01a151d8-dfbe-7d0b-938f-0eecefc95d4c); at 03:53:56–57 `set_project_storage` moved the project stealth → team. At 03:53:59 the log: `mirror/brightdesk/5dd63257b460d802.sqlite: a declared read ran on the writer: the sqlite connection closed`, and the run fell with `ThreadCallBroke` / `EffectDrizzleQueryError` on `select "value" from "meta" where "meta"."key" = ?` (key starting `law-revi…`).

The move closes the connection to the old graph copy, and the working run holds it and keeps reading through it. The operator may rightly move the store at any time; the run must survive the move — the next read goes to the new place — or the move waits for a step boundary. Find who holds the project's graph descriptor in the run (run context, law review / enforcement), and make it take the current store from the owner instead of a cached connection.

Fixed at the run-context and native-call owners: the graph opens at its logical place on reading; after approval its services update keeping the approved subject and prepared value. Opening during a move waits for the existing project permit. One integration test on real SQLite runs reading, preparing a second read, the stealth → team move, executing the prepared call and the next read; both answers after the move carry the new block body, the run completes. With the cached graph the test fell on law-revision / sqlite connection closed; before the approval-interval fix — not-served. Typecheck (5,102 files), this regression, the touch guidance, targeted native graph/approval/refusal and instruction-delivery tests checked. In the single independent review [[01a151ec-ae56-7845-ae8a-f6ad50e0a43b|reviewer]] found the approval interval and an unmigrated touch fixture; both findings fixed and verified. Working servers neither stopped nor restarted.
