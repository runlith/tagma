---
id: 01a12784-6b8f-74be-b7cf-dda49845fa3a
title: A stopped bash-call record in retained is deleted once its outcome is settled
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1278a-0c5f-7fd1-948b-8d34a5edaf0c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126f4-1128-7f6b-874c-dd005b569767
sources:
  - kind: symbol
    ref: packages/agent-tools/src/bash/tool.ts
    symbol: createBashTool
---
`createBashTool` holds a `retained` map per tool instance: `admitted` (`bash/managed.ts`) places a record on every call through `CommandWork`, and `execute` removes it only on a no-interrupt exit (`Effect.onExit` with `Exit.hasInterrupts`). A stopped or interrupted call leaves its record forever: `settleEffect` and `receipt` only read it. Every `admitted` record holds `acceptance` with the run handle, flows and closures, so the map grows with the number of stopped commands over the tool catalog's life.

Do: decide at the owner when a stopped call's outcome is finally settled (the `settleEffect` answer is recorded and `receipt` is no longer needed), and delete the record there. Done when a test through the tool's public operation shows that after stopping and settling the call its record is no longer held, while `settleEffect` before settling still answers the command outcome.
