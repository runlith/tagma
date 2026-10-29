---
id: 01a0cf56-2ae8-7287-a793-8238e5a549ef
title: "4b: remove control from the vocabulary, the host and its store, the server and its store — landing through a restart with no live executions"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d31d-d5b9-76c2-87b9-7e632ce011d4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-2840-7e57-a738-3a9fafbf1202
  - kind: waits-on
    to: 01a0cf4b-e148-79f3-b486-07e43320f75c
  - kind: waits-on
    to: 01a0cf56-2adb-756b-994c-a3635f7838e9
  - kind: waits-on
    to: 01a0cf56-2ade-7aa3-9d73-858e86856008
  - kind: waits-on
    to: 01a0cf56-2ae6-7d0d-8f25-fcafce024255
---
Build 4b of [[afbf1202]] (section 5) as one change across `packages/executions`, `packages/execution-host`, the server, the app and `packages/llm/src/capture`, after every other part of [[7aec9851]] stands. It raises the wire, so it lands only through a restart while no execution is live, and the commit says so. Done when the 4b cases of section 7 hold, a reviewer on the builder's own rung found nothing left open, and [[26641770]] and [[b8f0f683]] are finished or closed naming it.