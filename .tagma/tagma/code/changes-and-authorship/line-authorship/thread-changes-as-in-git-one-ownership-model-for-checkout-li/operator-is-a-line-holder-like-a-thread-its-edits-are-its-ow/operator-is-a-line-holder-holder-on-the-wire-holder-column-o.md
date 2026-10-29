---
id: 01a11808-74cb-7b06-9e37-7332919272b1
title: "Operator is a line holder: Holder on the wire, holder column, operator intake and merge, neighboring spec edits (worktree file-manager)"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3f9eefb0e60
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12e1e0d6c64f
---
Build [[eefb0e60]] in the `file-manager` worktree, when the S6 server ([[e0d6c64f]]) is closed and the branch is refreshed from main.

**Done when:** the spec acceptance passes; the 359519e0, fe04fc30, b17adfeb, and 762eb07f texts are edited for the operator holder; the cards are updated through `set_module`; typecheck, tests, and inspections are green; the change is committed.
