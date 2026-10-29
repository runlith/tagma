---
id: 01a14c14-6895-75c6-80f2-47b5276a0943
title: The agent types into its terminal, sends it its own interrupt, resizes it, and delivers an exact signal
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b7039c7507
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/operations/terminalActs.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/input.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/writers.ts
---
**Value.** The agent drives an interactive program — a REPL, a setup wizard, a TUI — the way a person at a keyboard would.

**How.** `write_terminal`, `interrupt_terminal`, `resize_terminal`, `signal_terminal`.

**Behaviour.**
- Bytes, interrupt, and size travel the run's own lane in one order; holding is checked on every act.
- The interrupt is the line's own interrupt character, known only to the host. If it cannot be delivered — no line discipline, the program switched signals off, there is no character, or the state cannot be read — the answer names the reason, and nothing is killed in place of the interrupt.
- The signal reaches the held execution separately from the stop; the answer is what the kernel accepted, not what the process did.
- Accepted bytes are no proof the program read them.

**Limits.** The agent types into another thread's terminal only by taking it over on the operator's word. The signal asks the operator in review mode and holds no operation key: a repeat is a second signal.
