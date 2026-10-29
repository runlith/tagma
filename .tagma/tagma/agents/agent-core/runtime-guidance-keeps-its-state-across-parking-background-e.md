---
id: 01a18955-35df-7272-93ae-b2ed2a7d9fac
title: Runtime guidance keeps its state across parking, background endings and command handoffs
ord: 204
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18907-f521-7d45-8045-92646bda8dc1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18936-d2a2-7c93-82d2-ef6195533681
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/calls/delivery.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/commandEndings.ts
---
Three gaps the review of 95533681 confirmed, sharing one cause: guidance outside the live loop has no structured, recorded road.

- A background call's guidance rides as text inside its ending notice, so `state` and `retell` are lost: the capability cue rule never sees its cue as delivered and offers it again on later matching calls.
- A bash call moved to the background ends as `completion: 'command'`; the native delivery settles it as `elsewhere` before reading its guidance, and the command-ending notice is built from execution data only, so that call's guidance is dropped.
- Guides the live loop queued in `stepGuides` before a batch parks — a parked call's `beforeTool` context, an answered sibling's `afterTool` context — are never drained: `AgentTurn` ends the parked batch without another plan, and the answer door rebuilds without them.

The road wanted: the guides travel structured (text, state, retell) with what the thread records — the owed call and its ending signal, the parking — and the next run turns them into guidance messages, the way `plan.ts` drains step guides.