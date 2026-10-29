---
id: 01a13be3-c9ba-795f-9f9f-43d324114795
title: "The turn-opening phase: the run before the first step names in feed and list what it waits for — the place graph or setup worktree"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be4-18d9-7fbc-ac0b-9148cdc5f4cc",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13ba2-803d-7614-a6da-3531b01a5749
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/context.ts
  - kind: file
    ref: packages/agent/src/agent/AgentPhase.ts
  - kind: file
    ref: packages/agent/src/thread/run/assembly/RunAssembly.ts
---
Implement the whole [[b01a5749|turn-opening phase spec]], items 1–5.

Why: 41 s before the first step the feed showed a bare "Working" while the run waited on the new worktree's graph.

Start with:
- `packages/agent/src/agent/AgentPhase.ts` — the `opening` phase and the `waiting` field;
- the `waitingOn` port in `ThreadContextUse` (`thread/agents/ThreadAgent.ts`);
- phase publication in `thread/run/assembly/RunAssembly.ts`;
- then `native-harness/turns/context.ts`, `threads/list/phase.ts`, `packages/chat-ui`, and the app.

Done when spec acceptance criteria 1–2 hold and the change has landed.
