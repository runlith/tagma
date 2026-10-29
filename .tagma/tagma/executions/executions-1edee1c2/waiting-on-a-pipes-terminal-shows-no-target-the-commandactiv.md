---
id: 01a126c0-3fcb-795a-81cc-b58fb62d810e
title: "Waiting on a pipes terminal shows no target: the CommandActivity index holds only pty/held"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126a3-dbf4-7264-bf8b-963cb35aae0b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126a2-f822-75ab-8f5e-481c28a0b015
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/Activity.svelte.ts
---
`wait_terminal` now declares a display with a `terminal` link, and the ribbon draws the target through `ProcessLine` from `CommandActivity` (`apps/tagma/app/src/lib/features/executions/commands/Activity.svelte.ts`, ~372–382). That index drops terminal-registry entries whose transport is not `pty` or whose lifetime is not `held`. `start_terminal` also supports held terminals with pipes, and `wait_terminal` accepts their address, so for such a target the wait line shows neither the target's state and time nor its command line.

What to do: decide what the index should know about a pipes terminal (take it into the index, or read the wait target separately by address) and show the target just like a pty terminal. Done when `wait_terminal` on a held pipes terminal draws the target's `CommandStatus` and its command line in the expansion.

Found by review of task 28a0b015 (the ribbon part of spec 7edf92bf).
