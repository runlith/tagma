---
id: 01a1031e-d5ce-7656-be01-1b1d15f5be11
title: Capture the thread's request together with the completed response, `sentAt`, and `measuredAt`
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1031f-50dc-7ab4-83d5-63966909d3e6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f53e04bf041
sources:
  - kind: file
    ref: packages/agent/src/agent/turn/call.ts
---
Builds [[e04bf041]] whole.

Start with `packages/agent/src/agent/turn/call.ts`, `AgentAside.ts`, and `packages/agent/src/thread/ThreadAsides.ts`.

Done when the spec's acceptance is met, including one usage sample on a real provider.
