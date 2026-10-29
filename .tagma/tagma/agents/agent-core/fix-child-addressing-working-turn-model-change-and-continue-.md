---
id: 01a12ae6-0547-761c-9498-e164925bcc0b
title: Fix child addressing, working-turn model change, and continue_agent refusals
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12ae5-11c4-7ccc-a600-146048c0ee18",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/reach.ts
  - kind: file
    ref: packages/agent/src/collaboration/toolCalls.ts
  - kind: file
    ref: packages/agent/src/collaboration/treeActs.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunExecution.ts
---
Fix three collaboration-door defects: one team-local name and thread-id resolver for every verb; `set_agent_model` carries the working turn onto the new model in one call; `continue_agent` keeps the typed refusal's code, cause, and unblock. Start with TreeActs, ThreadEnvelopes, ThreadModel, and hostCall. Completion is proven by contract red→green checks, the affected package's typecheck, an independent review, and a landed change.
