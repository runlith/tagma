---
id: 01a127f1-1025-7bbe-958f-8a34a624cd9e
title: Agent and agents links in verb cards carry the reached thread's home
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e3-7450-bc68-604d9047474c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127df-68ce-7e9a-94ba-389374c0f03d
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: packages/agent/src/collaboration/sendTools.ts
  - kind: file
    ref: packages/agent/src/collaboration/toolCalls.ts
  - kind: file
    ref: packages/agent/src/thread/record.ts
---
In `toolCalls.ts` and `sendTools.ts` the `agent`/`agents` links keep the addressee id without the project; `activityIdentity` and Conversation then take the home from the list, and for a never-seen addressee get the slot's project. Carry the reached thread owner's actual home through the result and display to navigation for stop/continue/compact/move and send/interrupt, including the retry of an accepted call. Done: owner unit tests on a B addressee the A list never saw, plus narrow contract checks.
