---
id: 01a12afd-3241-73b7-9ccc-5275de87e366
title: Keep typed placement refusals in native spawn_agent
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a12ae6-0547-761c-9498-e164925bcc0b
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/birth/placement.ts
---
Native spawn_agent folds PlacementRefused into generic ToolFailed, while the operation preserves GateRefusal.code/reason/unblock. Review of the collaboration fix found two shapes of one refusal. A shared refusal contract is needed on the product filler → collaboration boundary, with no server class imported up into packages/agent; the runtime tool must receive the code declaration from the placement owner. Check native/operation parity on a real named-worktree refusal. Changing this boundary contract is not part of the three current fixes.
