---
id: 01a1031e-d5ce-7656-be01-1b1e232faffc
title: "Thread recap: hot-cache generation, thread-record storage, reading, and the `threads.recap` setting"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1031f-50dc-7ab4-83d5-63966909d3e6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f54dff5b0dc
  - kind: waits-on
    to: 01a1031e-d5ce-7656-be01-1b1bce263514
  - kind: waits-on
    to: 01a1031e-d5ce-7656-be01-1b1d15f5be11
sources:
  - kind: file
    ref: apps/tagma/server/src/thread-record/store/table.ts
---
Builds [[dff5b0dc]] whole, together with the reader-input mark fix in `ThreadTurnRunner.ts` and `threadUserMessageEvent`.

Start with `apps/tagma/server/src/thread-record/store/table.ts`, `packages/agent/src/thread/run/ThreadTurnRunner.ts`, and the new `apps/tagma/server/src/threads/recap/`.

Done when the spec's acceptance is met and quality is verified on a small set of real threads.
