---
id: 01a14c14-6895-75c6-80f2-47bc1f435015
title: The project command inventory answers what is accepted, what the installation still vouches for, and what already ended, and a command's bytes are read even after its end
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bda6e02fd0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/cli/command.ts
  - kind: file
    ref: apps/tagma/server/src/executions/operations/commandCalls.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/operations/commandCatalog.ts
    symbol: COMMAND_OPERATIONS
---
**Value.** A seemingly idle machine is checked against fact: what work is still running or queued, whose it is, and how it ended.

**How.** `read_commands`, `read_command`, `read_command_bytes`; CLI `tagma command bytes`.

**Behaviour.**
- The inventory is an index of what the installation accepted, not a walk of the process table: it holds work queued before a process appears and work that ended without one. The holder is a thread, the operator, or a server service.
- Live fact pages come in one batched read of the host. Reading starts from the beginning or the end: work the installation still vouches for, or history.
- A command row carries its deadline with revision, the observation mode, the measured ending, and the current load.
- A host that does not answer is its own answer, which the surface must not draw as idle; no load sample is not zero.
- Held bytes of stdout, stderr, and output — both streams together in the order the host read them — are read by offset even after the command ends; a storage gap is named. Text arrives readable in the window, with the range and the next offset before it.

**Limits.** Reading starts nothing and grants no control. A link to a previous host generation addresses nothing.
