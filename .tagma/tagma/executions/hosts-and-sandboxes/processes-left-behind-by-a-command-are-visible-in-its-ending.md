---
id: 01a14c14-6895-75c6-80f2-47c2848a96fa
title: Processes left behind by a command are visible in its ending and in Load, and are terminated only after their identity is proven
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/operations/residuals.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/operations/residuals.ts
    symbol: RESIDUAL_OPERATIONS
  - kind: symbol
    ref: packages/agent-tools/src/CommandWork.ts
    symbol: cleanupWords
---
**Value.** A background process that escaped a finished command (`npm run dev &`) does not remain running unnoticed.

**How.** The `bash` answer and the stop receipt say what processes remained after the ending; Load counts them in the agent line and finishes them.

**Behaviour.** Before each signal the host re-proves the process by the birth witness the ending recorded, and refuses a pid the kernel gave to another process, an unknown identity, and a process not among the leftover. A process that survived terminate and kill shows as remaining, not finished.

**Limits.** The agent does not finish leftover processes: finishing acts exist only for the operator. No surface calls the separate `end_residual` and `end_residuals` operations — the window goes through Load process finishing — and they are reachable only over HTTP and via `tagma op`.
