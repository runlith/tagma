---
id: 01a111c0-a6a5-7a73-8f4d-f9f3d26be2a7
title: "Titles and recap as activity: trigger, model-chosen, input and output bodies, typed effect"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1128e-4fc6-71fe-a218-d6c4db28eef5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
  - kind: waits-on
    to: 01a111c0-a6a5-7a73-8f4d-f9f23b1981ef
---
The spec's "Titles and recap" section on top of the ready mechanism. Implemented in `d8a201f663` and `045ed26562`: `naming.itest.ts` reads a fresh, warm, and interrupted title, the same text, and recap through `read_thread` source `activity` with actor/trigger, model choice, bodies, source reader-input position, and effect. Contract unit/integration checks pass; the position source and aside cancellation are fixed at the producers. Agent/server typecheck ran and stays red outside this change; it reported no errors in the changed files. No live check ran after the server update: the server was not restarted.
