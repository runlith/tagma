---
id: 01a128e3-a6e0-7cb8-badd-c7115443fe67
title: Agent command wait defaults to 2 minutes
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12852-29c9-75ef-81e4-9b204590c35f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a128a5-e289-790a-b414-601856970fa1
sources:
  - kind: file
    ref: packages/agent-tools/src/CommandWork.ts
---
On 2026-10-11 the operator lowered `COMMAND_WAIT.defaultMs` from 3 to 2 minutes: a slow command holds the agent in place less. Fix note fd2bcad6 and the tests recording the old value in the same change.
