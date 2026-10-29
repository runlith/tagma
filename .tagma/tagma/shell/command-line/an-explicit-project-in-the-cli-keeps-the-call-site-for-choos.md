---
id: 01a1197c-360d-73cc-953a-a0b081925f63
title: An explicit project in the CLI keeps the call site for choosing the graph copy
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/cli/door.ts
    symbol: lens
---
The project and the checkout are independent parts of a call's address: `--project` selects the project, and cwd lets the server pick the graph of its current worktree. Dropping cwd with an explicit project silently sent the write to main. When cwd belongs to another repository, the choice of copy stays with the graph of the named project.
