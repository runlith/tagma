---
id: 01a0cfa8-d5df-7003-88d3-fd23fa3b5287
title: "Build the one-press update: server chain, checkout distance, tree fingerprint, persisted build record, CLI verb, popover and palette"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cf97-d540-7ae5-a373-8d19b7ff5db8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cfa8-97dd-7ed3-9301-569c2aa71f01
---
Implement [[2aa71f01]] in its §9 order. Start with `apps/tagma/server/src/http/checkoutBuilds.ts` and `protocol/machineStanding.ts`. The surface half is the prototype at `http://localhost:5634/a/5412ea3b7c38`. The work is complete when §7's acceptance holds, the claims of §8 are rewritten from the code, and the decision is closed into them.