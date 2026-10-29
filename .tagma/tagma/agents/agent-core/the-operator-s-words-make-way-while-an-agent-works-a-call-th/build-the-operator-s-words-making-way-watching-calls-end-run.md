---
id: 01a0f3e0-f9a5-7fb2-8393-a17d817d1ead
title: "Build the operator's words making way: watching calls end, running foreground commands move to the background, honest wait-ended answers, and the foreground sleep refusal"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f3a6-8d81-7be9-b159-5e07145fa075",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f3e0-df87-7dfb-bfa9-8b15356d0443
---
Build [[356d0443]] in its order of building. Start at `packages/agent/src/agent/AgentCalls.ts` (the way-making), `AgentToolDoor.stoppedAnswer` (the wait-ended answer) and `ThreadRunInbox` (the readable notice). Done when its acceptance criteria 1–7 hold, the touched claims are rewritten from the code, and the decision is closed into them.