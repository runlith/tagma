---
id: 01a14c14-6895-75c6-80f2-47b3a24c4397
title: The agent starts a long-lived process — dev server, watcher — as a terminal with no wait or life, and the operator sees it as a tab in the panel
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b479942bc7
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b5276a0943
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b678492cb5
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b8441e23be
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/doctrine/heldProcesses.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/operations/terminalCatalog.ts
    symbol: TERMINAL_OPERATIONS
---
**Value.** A dev server or file watcher outlives the agent's turn and is not killed by the command's time limit, and the operator sees what the agent left running.

**How.** `start_terminal` with held life and `stop_terminal`; the section of the agent instructions about processes that must live comes with the terminals capability.

**Behaviour.**
- A held execution outlives the call, the turn, the view that asked for it, and the server restart; a call execution ends with its call.
- An execution is pty — with geometry and screen — or pipes with a writable stdin; without a program a login shell of the server starts.
- The working directory is resolved by the server over the project registry. The agent names the work with a label every surface shows, and passes environment variables separately: their values are published nowhere.
- Custody lies with the starter; a pty terminal in the project place immediately becomes a tab in that place's panel.
- The stop answers with three groups: confirmed endings, resources that exactly survived the stop, and what could not be measured.

**Limits.** Starting and stopping ask the operator in review mode. A sandbox guest serves no held executions and refuses instead of starting work on the machine. Terminal tools exist only for agents with the terminals capability.
