---
id: 01a0ca8e-430d-7f06-b5a0-9c27a3cdb701
title: A wait on a command's observation fails with the cause when the observation is lost, never waits forever
ord: 1
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/agent-tools/src/bash
  - kind: file
    ref: packages/agent-tools/src/commandClass.ts
  - kind: file
    ref: packages/agent-tools/src/CommandWork.ts
  - kind: file
    ref: packages/executions/src/bunSpawner.ts
  - kind: symbol
    ref: packages/agent-tools/src/CommandWork.ts
    symbol: CommandAcceptance
---
The failure is `CommandUnreadable` and its reason names what was lost.