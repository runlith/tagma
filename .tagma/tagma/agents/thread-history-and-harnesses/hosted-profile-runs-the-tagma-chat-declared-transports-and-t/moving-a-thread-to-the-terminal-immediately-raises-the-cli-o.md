---
id: 01a14f30-8e04-7865-9123-fa249ab34f8d
title: Moving a thread to the terminal immediately raises the CLI on the same vendor session, with no prompt and no run
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c6e-0964-7380-a06d-52d9a91ff09c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a104aa-5f8f-7da6-b956-640dfe977076
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/switch.ts
---
The operator's decision. Now `set_thread_transport` only frees the idling ACP process and rewrites the binding; the terminal process is raised by the next run's `launch`, that is by the next message in the Tagma composer. Until then the thread has neither ACP nor a terminal, and "Move to the terminal" reads as "go work in the TUI".

Needed: moving to the terminal immediately launches the CLI with resume of the same vendor session (or a new one with a recap, where the session is not shared), with no prompt and no core run — a terminal process standing legally between turns ([[fe977076]]), no model request. A standalone turn in that TUI counts as `observed`, as today. Moving to ACP stays lazy. A launch failure does not roll the move back: the thread stays on the terminal, the cause is visible, the next word launches as today.

The idling process's launch owner is the terminal adapter, not the door: the switch asks the transport to raise the process after the binding is written. The operation description (`grammar` in `contract/wire/operations.ts`) and the feature [[44dc7c58]] are fixed by the same change.

Proof: a system test — moving ACP → terminal with no words leaves a standing CLI process on the same session, not one run and not one model request; the next word goes into that process with no second launch.
