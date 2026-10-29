---
id: 01a16462-4b34-7294-9530-f7b587a7ab7d
title: Parent learns of its child's model and reasoning change from a line on its next turn
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16462-8289-7661-b98c-cb52ccb71e8d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16449-f3a3-7a52-9c4a-904fe82af907
---
Operator's decision: a child's model (with provider) or reasoning-level change notifies the parent like `ran`, `compacted`, or `cooled`: a short line the parent reads on its next turn without being woken. Currently `threads/collaboration/childUpdates.ts` sends only `ran`, `compacted`, `cooled`; the operator switched a child from Opus xhigh to gpt-6.1-sol xhigh, the parent never learned of it and named the old model to the operator. The event is emitted by the single owner of thread events (spec, task [[037e8ec2]] in work), not by a fourth emitter beside it.
