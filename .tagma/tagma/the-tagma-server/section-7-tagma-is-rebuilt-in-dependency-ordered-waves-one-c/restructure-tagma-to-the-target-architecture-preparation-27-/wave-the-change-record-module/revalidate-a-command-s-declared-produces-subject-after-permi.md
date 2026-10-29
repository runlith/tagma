---
id: 01a0ea27-fe1e-78d1-8a8d-0d144ff7d900
title: Revalidate a command's declared `produces` subject after permission, refusing `declared-subject-changed` when it moved
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e445-113b-70ed-907c-9d7b9c085c6c
---
§3.13.4 of [[9c085c6c]]: a shell command's declared `produces` subject is approved at permission time, and it can change between the approval and the run. The approved subject must be revalidated after permission and before execution. If it moved, the command refuses with a typed `declared-subject-changed`, whose `unblock` names the subject as approved and as found. Nothing in `packages/agent-tools/src` does this today. It is a permission boundary separate from [[fa653215]]'s flights, queue and pending state, and wave-workspace found the gap while working that task.

Done when:
- the revalidation stands at the owner that grants permission;
- the refusal is declared on every operation that can answer with it;
- a unit test covers the unchanged, the moved and the vanished subject;
- the revalidation costs one read of the declared paths, never a rescan.