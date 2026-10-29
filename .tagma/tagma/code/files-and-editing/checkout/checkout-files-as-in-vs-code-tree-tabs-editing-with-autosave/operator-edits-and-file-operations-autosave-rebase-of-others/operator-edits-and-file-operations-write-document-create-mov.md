---
id: 01a11808-74cb-7b06-9e37-7333fb70821a
title: "Operator edits and file operations: write_document, create/move/trash/restore, trash, autosave, rebase and conflict (worktree file-manager)"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3fa588b85a5
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-732e77e5cfa2
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-732f162f719e
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-73311f61b3ee
  - kind: waits-on
    to: 01a11808-74cb-7b06-9e37-7332919272b1
---
Done: server `7ff1f35555`, `419e94e5d9`, `f3a3f20d5e`, `4d14910055`; client `8790cba65e`, `c59b3058f8`, `7d07c42038`, `d4ccf5538c`, `e3a75dba57`; all in main through `fb047c2350` — editor, autosave, rebase/conflict, drafts, file operations and undo, trash sweeper, and the [[54161a0c|Intake rule]].

Restored by the operator: unconditional draft restore, no `files.hotExit` setting — the [[588b85a5|spec]] is amended to the implemented behavior, no code change needed.

Only proof remains: the startup call to the sweeper is shown by the `CheckoutTrash.sweep` span; applicable inspections are green. The revision passed 20 client, 9 server, and 2 system tests, app/server typecheck clean; inspections and the startup span were not checked separately. A manual operator UI run is not a completion condition. Four waits-on are already done and need no reimplementation.
