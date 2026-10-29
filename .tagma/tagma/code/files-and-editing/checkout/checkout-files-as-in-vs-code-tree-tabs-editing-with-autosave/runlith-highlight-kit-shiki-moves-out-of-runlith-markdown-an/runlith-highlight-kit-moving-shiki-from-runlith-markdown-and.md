---
id: 01a117f0-0bea-795b-8d71-482db2e097cc
title: "@runlith/highlight kit: moving shiki from @runlith/markdown and edited-document highlight sessions (worktree file-manager)"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3f4413c99cc
---
Build [[413c99cc]] in the `file-manager` worktree.

Moving the highlighting and switching consumer imports waits for nothing; document sessions take `LineEdit` from `@runlith/files/lines.ts`, which [[e2787912]] lays first.

**Done when:** the spec acceptance passes; chat, graph bodies, and Git diff paint as before; the new kit card is created and c686d8c2 updated via `set_module`; typecheck, tests, and inspections green; the change committed to the `file-manager` branch.
