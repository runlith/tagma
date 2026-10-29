---
id: 01a15b5b-5488-75b1-82ce-0bc2572a0aa1
title: The commands badge in the thread row opens that thread's operations popover instead of the shared Load
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47bf37a0e8a9
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/LoadBadge.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/load/list.ts
---
Operator decision on the mockup http://localhost:5634/a/cbdcbeb8b7fd.

The commands badge in the thread row (`LoadBadge`) opens a popover next to the row on click, in place of the peek, instead of the shared Load. The popover holds only this thread's live commands and terminals.

- **One owner of the set.** The badge count and the popover rows are one projection of the thread's Load row: its executions with no harness session of their own. Load is shared per machine, so the badge works on another project's thread row too.
- **Data at the owner.** The server gives each execution of the Load row a signature, CPU share and memory: it already has the execution's process group. The signature is not cut by character count: the interface clips it.
- **Details from the command feed.** Wait or life clocks, the foreground program, ports, life change and output come from the project's command-feed row (`CommandView`) where one exists. Without it the row shows signature, figures and stop.
- **Row:** signature or command; clocks; program, port as a link, CPU and memory. On hover the clocks yield to buttons: for a command — output, life, stop; for a terminal — open, stop. A click expands the full command and live output.
- **Header:** the thread's count, CPU and memory, the full Load on the thread row, "Stop all" — stops the whole Load row, as in the Load panel. At the bottom a "left behind" row with a single action, if processes remain after the stop.
- A popover opened by click does not yield to peek on hovering other rows.
