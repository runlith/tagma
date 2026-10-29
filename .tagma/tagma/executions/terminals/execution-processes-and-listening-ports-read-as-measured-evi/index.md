---
id: 01a14c14-6895-75c6-80f2-47b678492cb5
title: Execution processes and listening ports read as measured evidence, not guesses from text
ord: 9
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/Activity.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/processes/lines.ts
  - kind: file
    ref: apps/tagma/server/src/executions/operations/terminalReads.ts
---
**Value.** The agent learns what its terminal actually started and on which port the dev server listens, without guessing from output.

**How.** `read_terminal_processes`, `read_terminal_ports`; listening sockets also stand in `read_terminals` lines.

**Behaviour.**
- The report carries its own completeness and names unmeasured areas: an empty list under unavailable measurement does not mean "nothing is running" or "the port is free".
- A process without a proven link to the execution is shown but not attributed to it; a URL a program printed creates no port.
- Ports are separated by environment: one number in two environments is two listeners.

**Limits.** Reading grants no control: a pid from the report is not accepted by any termination operation. Ports are not shown to the operator: the window computes them for each terminal line in its command model, but no screen draws them.
